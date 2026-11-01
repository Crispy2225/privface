import uuid
from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, JSON, LargeBinary, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def identifier():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=False)


class Invitation(Base):
    __tablename__ = 'invitations'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), unique=True)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Credential(Base):
    __tablename__ = 'credentials'
    id: Mapped[str] = mapped_column(String(1024), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(BigInteger, default=0)


class LoginSession(Base):
    __tablename__ = 'sessions'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    csrf: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[int] = mapped_column(BigInteger)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    proof_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Challenge(Base):
    __tablename__ = 'challenges'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), index=True)
    operation: Mapped[str] = mapped_column(String(16))
    nonce: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    credential_id: Mapped[str | None] = mapped_column(ForeignKey('credentials.id'), nullable=True)
    session_digest: Mapped[str | None] = mapped_column(ForeignKey('sessions.digest'), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)


class Enrollment(Base):
    __tablename__ = 'enrollments'
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    credential_id: Mapped[str | None] = mapped_column(ForeignKey('credentials.id'), nullable=True)
    commitment: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    quantization: Mapped[str] = mapped_column(String(64))
    scheme: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class RecoveryCode(Base):
    __tablename__ = 'recovery_codes'
    account_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger)


class RateBucket(Base):
    __tablename__ = 'rate_buckets'
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(BigInteger)
    count: Mapped[int] = mapped_column(Integer)


def connect(url):
    engine = create_engine(url, pool_pre_ping=True, connect_args={'check_same_thread': False} if url.startswith('sqlite') else {})
    if url.startswith('sqlite'):
        @event.listens_for(engine, 'connect')
        def sqlite_constraints(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
    return engine, sessionmaker(engine, expire_on_commit=False)
