"""Open password registration; retain historical records without preserving old sessions."""
from alembic import op
import sqlalchemy as sa
revision='f813e48b1a9c'
down_revision='e3125df5b87a'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('accounts',sa.Column('password_hash',sa.String(256),nullable=True))
    with op.batch_alter_table('enrollments') as batch:
        batch.alter_column('credential_id',existing_type=sa.String(1024),nullable=True)
    op.execute(sa.text('UPDATE sessions SET revoked = true'))
    op.execute(sa.text('UPDATE challenges SET consumed = true'))

def downgrade():
    # Password bindings have no credential and cannot be represented by the old schema.
    raise RuntimeError('Password migration needs an explicit data migration before downgrade')
