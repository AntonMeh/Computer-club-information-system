# Клубна система

Інформаційна система мережі комп'ютерних клубів (навчальний проєкт): облік клієнтів, робочих місць, ігрових сеансів, оплат, витрат, персоналу та турнірів.

**Стек:** PostgreSQL · Python 3.11+ / FastAPI (SQLAlchemy 2, Alembic, JWT) · React 18 (Vite, React Router, Lucide)

## Структура

```
backend/             FastAPI: моделі (11 таблиць), роутери, JWT-автентифікація, ролі, міграції Alembic, тести
frontend/            React (Vite): каркас застосунку, роутер, компоненти дизайн-системи, сторінки за ролями
docker-compose.yml   PostgreSQL однією командою
```

## Швидкий старт (Windows PowerShell)

Потрібні: Docker, Python 3.11+, Node.js 18+.

### 1. База даних

```powershell
Copy-Item .env.example .env
docker compose up -d db
```

### 2. Бекенд

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env

# Згенерувати та записати SECRET_KEY у backend/.env
$key = python -c "import secrets; print(secrets.token_urlsafe(48))"
(Get-Content .env) -replace '^SECRET_KEY=.*', "SECRET_KEY=$key" | Set-Content .env

alembic upgrade head          # застосовує міграції в PostgreSQL
python -m app.seed --reset    # наповнює базу демо-даними та користувачами

uvicorn app.main:app --reload
```

API: http://localhost:8000 · документація (Swagger): http://localhost:8000/docs

Тести (не потребують PostgreSQL, працюють на SQLite у пам'яті):

```powershell
pytest
```

### 3. Фронтенд

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Інтерфейс: http://localhost:5173

## Демо-користувачі (пароль для всіх: `demo1234`)

| Логін | Роль | ПІБ | Доступ до клубів |
| --- | --- | --- | --- |
| `director` | Директор | Віктор Романенко | Уся мережа |
| `hall_admin` | Адміністратор залу | Богдан Савчук | Cyberion Центр |
| `accountant` | Бухгалтер | Ірина Остапенко | Cyberion Центр |
| `tournaments` | Менеджер турнірів | Максим Гаврилюк | Cyberion Центр |
| `marketing` | Менеджер з реклами | Катерина Руденко | Cyberion Центр |
| `sysadmin` | Системний адміністратор | Тарас Пономаренко | Cyberion Центр |

Якщо демо-дані вже були створені раніше без облікових записів, додати лише користувачів можна командою:

```powershell
python -m app.seed --users
```

## Поточний стан (Етап 0 «Основа» завершено)

- 11 таблиць БД (`club`, `workstation`, `client`, `tariff`, `session`, `payment`, `staff`, `tournament`, `participation`, `expense`, `app_user`), частковий унікальний індекс активного сеансу та `CHECK`-обмеження.
- Автентифікація JWT (`/auth/login`, `/auth/me`, `/auth/change-password`), блокування після 5 невдалих спроб входу, перевірка сили `SECRET_KEY`.
- Матриця прав для 6 ролей із перевіркою і на бекенді (403), і на фронтенді.
- Каркас застосунку (бічна панель з групами за ролями, смуга заголовка з перемикачем клубу, годинником і меню користувача), компоненти дизайн-системи (`Drawer`, `ConfirmDialog`, `Badge`, `Toast`, `SkeletonTable`, `EmptyState`, `ErrorState`).
- 44 автотести бекенду (`pytest`).
