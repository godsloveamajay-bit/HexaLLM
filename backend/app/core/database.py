from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

_is_sqlite = "sqlite" in settings.DATABASE_URL

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_size=10 if not _is_sqlite else 5,
    max_overflow=20 if not _is_sqlite else 0,
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
