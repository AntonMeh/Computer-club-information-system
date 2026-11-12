import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  PlayCircle,
  Shield,
  Wrench,
} from "lucide-react";

const VARIANT_ICONS = {
  success: CheckCircle2,
  info: PlayCircle,
  warning: AlertTriangle,
  danger: Ban,
  neutral: Wrench,
  role: Shield,
  clock: Clock,
};

const STATUS_MAP = {
  вільне: { variant: "success", icon: CheckCircle2, label: "Вільне" },
  зайняте: { variant: "info", icon: PlayCircle, label: "Зайняте" },
  "на ремонті": { variant: "neutral", icon: Wrench, label: "На ремонті" },
  активний: { variant: "info", icon: Clock, label: "Активний" },
  завершений: { variant: "success", icon: CheckCircle2, label: "Завершений" },
  скасований: { variant: "neutral", icon: Ban, label: "Скасований" },
  майбутній: { variant: "warning", icon: Clock, label: "Майбутній" },
  сьогодні: { variant: "info", icon: PlayCircle, label: "Сьогодні" },
  активний_користувач: { variant: "success", icon: CheckCircle2, label: "Активний" },
  вимкнений: { variant: "neutral", icon: Ban, label: "Вимкнений" },
};

/**
 * Бейдж статусу: кольоровий фон + іконка + текст (колір ніколи не є єдиною ознакою).
 */
export function Badge({ variant = "neutral", icon: CustomIcon, children }) {
  const Icon = CustomIcon || VARIANT_ICONS[variant] || Shield;
  return (
    <span className={`badge badge-${variant}`}>
      <Icon size={14} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function StatusBadge({ status }) {
  const cfg = STATUS_MAP[status] || { variant: "neutral", icon: Shield, label: status || "—" };
  return (
    <Badge variant={cfg.variant} icon={cfg.icon}>
      {cfg.label}
    </Badge>
  );
}
