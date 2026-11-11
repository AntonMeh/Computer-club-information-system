"""Матриця прав за ролями (розділ 4 специфікації).

Рівні доступу:
- "view"   - перегляд;
- "full"   - перегляд і зміни;
- "repair" - перегляд залу + право ставити/знімати статус «на ремонті» (Сисадмін).

Відсутність розділу для ролі означає, що розділ їй недоступний.
"""

VIEW = "view"
FULL = "full"
REPAIR = "repair"

DIRECTOR = "director"
HALL_ADMIN = "hall_admin"
ACCOUNTANT = "accountant"
TOURNAMENT_MANAGER = "tournament_manager"
MARKETING_MANAGER = "marketing_manager"
SYSADMIN = "sysadmin"

ROLE_LABELS = {
    DIRECTOR: "Директор",
    HALL_ADMIN: "Адміністратор залу",
    ACCOUNTANT: "Бухгалтер",
    TOURNAMENT_MANAGER: "Менеджер турнірів",
    MARKETING_MANAGER: "Менеджер з реклами",
    SYSADMIN: "Системний адміністратор",
}

ALL_ROLES = {role: VIEW for role in ROLE_LABELS}

PERMISSIONS: dict[str, dict[str, str]] = {
    "dashboard": ALL_ROLES,
    "hall": {DIRECTOR: VIEW, HALL_ADMIN: FULL, SYSADMIN: REPAIR},
    "sessions": {DIRECTOR: VIEW, HALL_ADMIN: FULL, ACCOUNTANT: VIEW},
    "clients": {DIRECTOR: FULL, HALL_ADMIN: FULL, TOURNAMENT_MANAGER: VIEW, MARKETING_MANAGER: VIEW},
    "tariffs": {DIRECTOR: FULL, HALL_ADMIN: VIEW, ACCOUNTANT: VIEW, MARKETING_MANAGER: VIEW},
    "workstations": {DIRECTOR: FULL, HALL_ADMIN: VIEW, SYSADMIN: FULL},
    "payments": {DIRECTOR: VIEW, HALL_ADMIN: VIEW, ACCOUNTANT: VIEW},
    "expenses": {DIRECTOR: FULL, ACCOUNTANT: FULL},
    "reports": {DIRECTOR: FULL, ACCOUNTANT: FULL, MARKETING_MANAGER: VIEW},
    "tournaments": {DIRECTOR: FULL, HALL_ADMIN: VIEW, TOURNAMENT_MANAGER: FULL, MARKETING_MANAGER: VIEW},
    "staff": {DIRECTOR: FULL, HALL_ADMIN: VIEW, ACCOUNTANT: VIEW},
    "clubs": {DIRECTOR: FULL, SYSADMIN: VIEW},
    "users": {DIRECTOR: FULL, SYSADMIN: FULL},
}

# Які рівні задовольняють вимогу
_SATISFIES = {
    VIEW: {VIEW, FULL, REPAIR},
    REPAIR: {REPAIR, FULL},
    FULL: {FULL},
}


def level_for(role: str, section: str) -> str | None:
    return PERMISSIONS.get(section, {}).get(role)


def allowed(role: str, section: str, required: str = VIEW) -> bool:
    level = level_for(role, section)
    return level is not None and level in _SATISFIES[required]


def permissions_for(role: str) -> dict[str, str]:
    """Розділи, доступні ролі, з рівнем доступу (віддається фронтенду в /auth/me)."""
    return {section: roles[role] for section, roles in PERMISSIONS.items() if role in roles}

