"use client";
import Image from "next/image";
import { useState } from "react";

export default function AssetLogo({
  src,
  symbol,
  name,
  size = 48,
  color = "#6366f1",
  className = "",
}: {
  src: string;
  symbol: string;
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      style={{ width: size, height: size }}
    >
      {!failed ? (
        <Image
          src={src}
          alt={`${name} logo`}
          width={size}
          height={size}
          className="h-full w-full object-contain p-1.5"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center font-mono text-[10px] font-black text-white"
          style={{ background: color }}
        >
          {symbol.slice(0, 5)}
        </span>
      )}
    </span>
  );
}
