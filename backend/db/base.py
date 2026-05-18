from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass

# Import ALL models

from modules.users.model import *
from modules.roles.model import *
from modules.permissions.model import *
from modules.org_units.model import *

from modules.assets.model import *
from modules.orders.model import *

from modules.auth.model import *

from modules.approvals.model import *

from modules.features.model import *

from modules.settings.model import *

from modules.audit.model import *

from modules.emails.model import *

from modules.auth_policy.model import *

from modules.mfa.model import *

from modules.rbac_audit.model import *

from modules.rbac_versioning.model import *
