import { Link } from "react-router-dom";
import { Ban, Compass, Layers } from "lucide-react";
import { Badge } from "../components/Badge.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export function ForbiddenPage() {
  return (
    <section className="page-section">
      <div className="panel state-box">
        <Ban size={32} className="state-icon danger" aria-hidden="true" />
        <h1>Немає доступу</h1>
        <p className="state-text">
          У вашої ролі немає прав для перегляду цього розділу.
        </p>
        <Link to="/" className="btn btn-primary">
          На головну
        </Link>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="page-section">
      <div className="panel state-box">
        <Compass size={32} className="state-icon" aria-hidden="true" />
        <h1>Сторінку не знайдено</h1>
        <p className="state-text">
          Запитаної адреси не існує або її було переміщено.
        </p>
        <Link to="/" className="btn btn-primary">
          На головну
        </Link>
      </div>
    </section>
  );
}

const LEVEL_NAMES = {
  full: "Повний доступ",
  view: "Лише перегляд",
  repair: "Перегляд + ремонт",
};

export function SectionPlaceholderPage({ title, section, description }) {
  const { user, clubs, selectedClubId } = useAuth();
  const level = user?.permissions?.[section] || "view";
  const selectedClub = clubs.find((c) => c.club_id === selectedClubId);

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>{title}</h1>
        <Badge variant={level === "full" ? "success" : "info"}>
          {LEVEL_NAMES[level] || level}
        </Badge>
      </div>

      <div className="panel state-box">
        <Layers size={28} className="state-icon" aria-hidden="true" />
        <p className="state-text">{description}</p>
        <p className="subtle-meta">
          Поточний фільтр клубу:{" "}
          <strong>{selectedClub ? selectedClub.name : "Усі клуби"}</strong>
        </p>
      </div>
    </section>
  );
}

