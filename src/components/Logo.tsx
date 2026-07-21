import { ctiEsignLogo } from '../assets/ctiEsignLogo'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="flex h-14 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1.5">
        <img src={ctiEsignLogo} alt="CTI eSign" className="h-full w-full object-contain" />
      </span>
      <div className="leading-tight">
        <span className="block font-heading text-2xl font-extrabold tracking-tight text-cti-black">
          CTI <span className="text-cti-red">eSign</span>
        </span>
        <span className="block text-sm font-semibold text-cti-gray">Official eSignature Platform</span>
      </div>
    </div>
  )
}
