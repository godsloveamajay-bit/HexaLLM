"""Seed a deterministic E2E user into the configured database."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models.user import User

Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    user = db.query(User).filter(User.email == "test@example.com").first()
    if user is None:
        user = User(
            email="test@example.com",
            username="testuser",
            hashed_password=hash_password("TestPass123!"),
            is_admin=True,
        )
        db.add(user)
        db.commit()
        print("seeded test@example.com")
    else:
        print("test@example.com already exists")
finally:
    db.close()
