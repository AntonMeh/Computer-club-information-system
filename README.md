# Клубна система

Інформаційна система комп'ютерного клубу (навчальний проєкт): облік клієнтів, робочих місць, сеансів, оплат, витрат, персоналу та турнірів.

**Стек:** PostgreSQL · Python + FastAPI (SQLAlchemy, Alembic) · React (Vite)

## Структура

```
backend/    FastAPI: моделі (10 таблиць), схеми, роутери, міграції Alembic, тести
frontend/   React (Vite): інтерфейс адміністратора
docs/       ER-діаграма (draw.io + PNG)
docker-compose.yml   PostgreSQL одною командою
```

## Швидкий старт

Потрібні: Docker, Python 3.11+, Node.js 18+.

### 1. База даних

```bash
cp .env.example .env
docker compose up -d db
```

### 2. Бекенд

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env

alembic revision --autogenerate -m "init"   # створює першу міграцію з моделей
alembic upgrade head                        # створює таблиці в PostgreSQL

uvicorn app.main:app --reload
```

API: http://localhost:8000 · документація (Swagger): http://localhost:8000/docs

Тести (не потребують PostgreSQL, працюють на SQLite у пам'яті):

```bash
pytest
```

### 3. Фронтенд

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Інтерфейс: http://localhost:5173

## Що вже є

- 10 ORM-моделей за ER-діаграмою: `club`, `workstation`, `client`, `tariff`, `session`, `payment`, `staff`, `tournament`, `participation`, `expense`
- CRUD API для `clubs` і `clients` (еталон, за яким робляться решта сутностей)
- Перевірка `/health`, CORS для фронтенду, автотести
- Інтерфейс із переліком і додаванням/видаленням клубів і клієнтів

## Наступні кроки

1. Роутери та сторінки для решти сутностей: `workstation`, `tariff`, `staff`, `tournament`, `expense`
2. Логіка сеансів: старт/завершення на робочому місці, підрахунок вартості за тарифом, створення `payment`
3. Авторизація та ролі (адміністратор залу, директор, бухгалтер)
4. Звіти: доходи/витрати за період, завантаженість місць
