from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta
from ..core.database import get_db
from ..core.security import (
    hash_password, verify_password, create_access_token,
    generate_api_key, get_current_user,
)
from ..models.user import User, APIKey
from ..schemas.auth import UserRegister, UserLogin, UserOut, UserUpdate, TokenResponse, APIKeyCreate, APIKeyOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    # First user becomes admin
    is_admin = db.query(User).count() == 0

    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/api-keys", response_model=list[APIKeyOut])
def list_api_keys(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    keys = db.query(APIKey).filter(APIKey.user_id == current_user.id).all()
    return keys


@router.post("/api-keys", response_model=APIKeyOut, status_code=201)
def create_api_key(data: APIKeyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    key = APIKey(
        user_id=current_user.id,
        name=data.name,
        key=generate_api_key(),
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


@router.delete("/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    key = db.query(APIKey).filter(APIKey.id == key_id, APIKey.user_id == current_user.id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(key)
    db.commit()
