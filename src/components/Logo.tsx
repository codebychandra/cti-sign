export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
        <rect width="64" height="64" rx="12" fill="#111111" />
        <path
          d="M14 40c6 0 8-16 14-16s6 12 12 12 8-8 10-8"
          fill="none"
          stroke="#E11B22"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-heading text-lg font-extrabold tracking-tight text-cti-black">
        CTI <span className="text-cti-red">Sign</span>
      </span>
    </div>
  )
}
