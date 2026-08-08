// Mist Design System primitives, transcribed from the exported
// _ds_bundle.js (Button, IconButton, Input, Textarea, Alert, StatusTag,
// Avatar, Icon). Geometry and colors are verbatim from the bundle.
import React, { useState } from 'react';
import { ICONS } from './icon-data';

/* ── Icon ─────────────────────────────────────────────────────────── */

export function Icon({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}

/* ── Button ───────────────────────────────────────────────────────── */

const BTN_SIZES = {
  sm: { height: 24, padding: '0 8px', gap: 4, fontSize: 13, icon: 12 },
  md: { height: 32, padding: '0 12px', gap: 8, fontSize: 14, icon: 16 },
  lg: { height: 48, padding: '0 16px', gap: 8, fontSize: 16, icon: 24 },
};

const BTN_SCHEMES = {
  primary: {
    solidBg: 'var(--color-blue-400)', solidHover: 'var(--color-blue-500)',
    fg: 'var(--color-blue-500)', subtle: 'var(--color-blue-50)', border: 'var(--color-blue-400)',
  },
  neutral: {
    solidBg: 'var(--color-gray-600)', solidHover: 'var(--color-gray-700)',
    fg: 'var(--color-gray-700)', subtle: 'var(--color-gray-100)', border: 'var(--color-gray-300)',
  },
  error: {
    solidBg: 'var(--color-red-600)', solidHover: 'var(--color-red-700)',
    fg: 'var(--color-red-600)', subtle: 'var(--color-red-50)', border: 'var(--color-red-600)',
  },
};

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  size?: keyof typeof BTN_SIZES;
  variant?: 'solid' | 'outline' | 'ghost';
  colorScheme?: keyof typeof BTN_SCHEMES;
  isDisabled?: boolean;
}

export function Button({
  children, size = 'md', variant = 'solid', colorScheme = 'primary',
  isDisabled = false, style, ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const s = BTN_SIZES[size];
  const c = BTN_SCHEMES[colorScheme];
  let vs: React.CSSProperties;
  if (variant === 'solid') {
    vs = { backgroundColor: hover && !isDisabled ? c.solidHover : c.solidBg, color: '#fff' };
  } else if (variant === 'outline') {
    vs = {
      backgroundColor: hover && !isDisabled ? c.subtle : 'var(--color-black-white-white)',
      boxShadow: `inset 0 0 0 1px ${c.border}`, color: c.fg,
    };
  } else {
    vs = { backgroundColor: hover && !isDisabled ? c.subtle : 'transparent', color: c.fg };
  }
  return (
    <button
      type="button"
      disabled={isDisabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: s.gap, height: s.height, padding: s.padding,
        borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)',
        fontWeight: 600, fontSize: s.fontSize, lineHeight: 1.2,
        whiteSpace: 'nowrap', boxSizing: 'border-box', border: 'none',
        cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.4 : 1,
        transition: 'background-color .12s ease, box-shadow .12s ease, color .12s ease',
        ...vs, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── IconButton ───────────────────────────────────────────────────── */

const ICONBTN_SIZES = { sm: { box: 24, icon: 14 }, md: { box: 32, icon: 16 } };

export function IconButton({
  icon, size = 'md', 'aria-label': ariaLabel, onClick, style,
}: {
  icon: string; size?: keyof typeof ICONBTN_SIZES; 'aria-label': string;
  onClick?: () => void; style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const s = ICONBTN_SIZES[size];
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: s.box, height: s.box, borderRadius: 'var(--radius-md)',
        border: 'none', cursor: 'pointer',
        backgroundColor: hover ? 'var(--color-gray-100)' : 'transparent',
        color: 'var(--color-gray-600)',
        transition: 'background-color .12s ease',
        ...style,
      }}
    >
      <Icon name={icon} size={s.icon} />
    </button>
  );
}

/* ── Input ────────────────────────────────────────────────────────── */

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'disabled'> {
  leftIcon?: string;
  rightIcon?: React.ReactNode;
  isInvalid?: boolean;
  isDisabled?: boolean;
  inputStyle?: React.CSSProperties;
}

export function Input({
  leftIcon, rightIcon, isInvalid = false, isDisabled = false,
  style, inputStyle, ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false);
  const border = isInvalid
    ? 'var(--color-red-600)'
    : focus ? 'var(--color-blue-400)' : 'var(--color-gray-300)';
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 32, padding: '0 8px', width: '100%', maxWidth: '100%',
        borderRadius: 'var(--radius-md)',
        backgroundColor: isDisabled ? 'var(--color-gray-50)' : 'var(--color-black-white-white)',
        boxShadow: `inset 0 0 0 ${focus ? 2 : 1}px ${border}`,
        boxSizing: 'border-box', opacity: isDisabled ? 0.6 : 1,
        transition: 'box-shadow .12s ease',
        ...style,
      }}
    >
      {leftIcon && (
        <span style={{ display: 'inline-flex', color: 'var(--color-gray-400)', flexShrink: 0 }}>
          <Icon name={leftIcon} size={16} />
        </span>
      )}
      <input
        disabled={isDisabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
          lineHeight: '20px', color: 'var(--color-gray-700)',
          ...inputStyle,
        }}
        {...rest}
      />
      {rightIcon && (
        <span style={{ display: 'inline-flex', color: 'var(--color-gray-400)', flexShrink: 0 }}>
          {rightIcon}
        </span>
      )}
    </div>
  );
}

/* ── Textarea ─────────────────────────────────────────────────────── */

interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'disabled'> {
  isDisabled?: boolean;
}

export function Textarea({ isDisabled = false, style, ...rest }: TextareaProps) {
  const [focus, setFocus] = useState(false);
  const border = focus ? 'var(--color-blue-400)' : 'var(--color-gray-300)';
  return (
    <textarea
      disabled={isDisabled}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        width: '100%', maxWidth: '100%', padding: '6px 8px',
        borderRadius: 'var(--radius-md)',
        backgroundColor: isDisabled ? 'var(--color-gray-50)' : 'var(--color-black-white-white)',
        boxShadow: `inset 0 0 0 ${focus ? 2 : 1}px ${border}`,
        border: 'none', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
        fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: 13,
        lineHeight: '20px', color: 'var(--color-gray-700)',
        opacity: isDisabled ? 0.6 : 1, transition: 'box-shadow .12s ease',
        ...style,
      }}
      {...rest}
    />
  );
}

/* ── Alert ────────────────────────────────────────────────────────── */

const ALERT_STATUS = {
  info: { key: 'blue', icon: 'Info' },
  success: { key: 'green', icon: 'CircleCheck' },
  warning: { key: 'orange', icon: 'TriangleAlert' },
  error: { key: 'red', icon: 'OctagonX' },
};

export function Alert({
  status = 'info', title, children,
}: {
  status?: keyof typeof ALERT_STATUS; title?: string; children?: React.ReactNode;
}) {
  const st = ALERT_STATUS[status];
  const accent = `var(--color-${st.key}-500)`;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
        borderRadius: 'var(--radius-md)', boxSizing: 'border-box', width: '100%',
        backgroundColor: `var(--color-${st.key}-50)`,
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, color: accent, marginTop: 1 }}>
        <Icon name={st.icon} size={20} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {title && (
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, lineHeight: '24px', color: 'var(--color-gray-700)' }}>
            {title}
          </span>
        )}
        {children && (
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: 14, lineHeight: '20px', color: 'var(--color-gray-700)' }}>
            {children}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── StatusTag ────────────────────────────────────────────────────── */

const STATUSTAG_VARIANTS: Record<string, string> = {
  success: 'var(--color-green-400)',
  warning: 'var(--color-orange-400)',
  critical: 'var(--color-red-600)',
  info: 'var(--color-gray-400)',
  neutral: 'var(--color-gray-400)',
};

export function StatusTag({ children, variant = 'info' }: { children: React.ReactNode; variant?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
        borderRadius: 'var(--radius-md)',
        background: STATUSTAG_VARIANTS[variant] || STATUSTAG_VARIANTS.info,
        color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600,
        fontSize: 13, lineHeight: 1, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────── */

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: 'var(--color-gray-300)', color: 'var(--color-gray-700)',
        fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 9,
      }}
    >
      {initials}
    </span>
  );
}

/* ── Spinner ──────────────────────────────────────────────────────── */

export function Spinner({ size = 14, light = true }: { size?: number; light?: boolean }) {
  return (
    <span
      style={{
        width: size, height: size,
        border: `2px solid ${light ? 'rgba(255,255,255,.4)' : 'var(--color-gray-200)'}`,
        borderTopColor: light ? '#fff' : 'var(--color-blue-400)',
        borderRadius: '50%', display: 'inline-block', flexShrink: 0,
        animation: 'pp-spin .7s linear infinite',
      }}
    />
  );
}

/* ── PinMarker — the numbered teardrop from the design's pin spec ──── */

export function PinMarker({ n = 1, size = 26 }: { n?: number; size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, background: 'var(--color-red-500)',
        borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
        boxShadow: '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{ transform: 'rotate(45deg)', color: '#fff', font: `700 ${Math.round(size * 0.42)}px Inter,sans-serif` }}>
        {n}
      </span>
    </div>
  );
}
