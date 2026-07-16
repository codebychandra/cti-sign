import { ctiEsignLogo } from '../assets/ctiEsignLogo'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md">
        <img src={ctiEsignLogo} alt="CTI eSign" className="h-12 w-12 scale-[3.2] object-contain" />
      </span>
      <div className="leading-tight">
        <span className="block font-heading text-2xl font-extrabold tracking-tight text-cti-black">
          CTI <span className="text-cti-red">eSign</span>
        </span>
        <span className="block text-sm font-semibold uppercase text-cti-gray">Document signing</span>
      </div>
    </div>
  )
}
