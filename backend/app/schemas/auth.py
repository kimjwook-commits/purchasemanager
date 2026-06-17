from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    permissions: list[str]


class UserRead(BaseModel):
    model_config = {"from_attributes": True}

    user_id: int
    username: str
    email: str
    is_active: bool
    permissions: list[str] = []
