import { useState } from "react";
import { LABEL_PALETTE } from "../../convex/lib/constants";
// Single source of truth: the client validates exactly the way the server does,
// so a value the picker accepts is never rejected by the mutation.
import { normalizeColor } from "../../convex/lib/labelPresets";

/**
 * Colour control: the quick palette plus a native OS colour picker and a HEX
 * field for exact values. Only `#rgb` / `#rrggbb` survives — anything else
 * falls back to the default, so the value is always safe to inline into a
 * `style` attribute.
 */
export default function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = normalizeColor(value);

  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((v) => !v)}
          style={{ gap: 7, minWidth: 132 }}
          aria-expanded={open}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: current,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)",
              flexShrink: 0,
            }}
          />
          <span className="mono" style={{ fontSize: 12.5 }}>
            {current}
          </span>
          <span className="faint">{open ? "▴" : "▾"}</span>
        </button>

        <input
          className="input mono"
          value={value}
          onChange={(e) => onChange(normalizeColor(e.target.value))}
          placeholder="#22c55e"
          spellCheck={false}
          style={{ maxWidth: 120, fontSize: 13 }}
          aria-label="十六进制颜色"
        />

        <label
          className="btn"
          style={{ cursor: "pointer", gap: 6 }}
          title="打开系统取色器"
        >
          🎨 取色器
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: "absolute",
              width: 0,
              height: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="系统取色器"
          />
        </label>
      </div>

      {open && (
        <div
          className="card"
          style={{ padding: 10, marginTop: 8, display: "flex", flexDirection: "column", gap: 9 }}
        >
          <div className="row wrap" style={{ gap: 6 }}>
            {LABEL_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                title={c}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: c,
                  border: current.toLowerCase() === c ? "2px solid var(--text)" : "1px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <div className="faint" style={{ fontSize: 11.5 }}>
            也可直接在右侧输入 HEX；只接受 #rgb 或 #rrggbb
          </div>
        </div>
      )}
    </div>
  );
}
