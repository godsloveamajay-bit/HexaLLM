from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from .config import settings

_is_sqlite = "sqlite" in settings.DATABASE_URL

# SQLite: NullPool — each request opens its own connection (WAL gives us
# concurrent readers + a single writer). A bounded QueuePool is fatal here:
# every streaming chat holds a DB session open for the whole response, so a
# handful of concurrent streams exhaust the pool and *every* other request
# (health checks, session lists) times out — reads as "the server is off".
if _is_sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 30},
        poolclass=NullPool,
    )
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
    )

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")   # concurrent reads + writes
        cur.execute("PRAGMA synchronous=NORMAL") # faster writes, still safe
        cur.execute("PRAGMA cache_size=-32000")  # 32 MB page cache
        cur.execute("PRAGMA temp_store=MEMORY")  # temp tables in RAM
        cur.execute("PRAGMA mmap_size=268435456") # 256 MB memory-mapped I/O
        cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
