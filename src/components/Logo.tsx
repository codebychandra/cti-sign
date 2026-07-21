import { ctiEsignLogo } from '../assets/ctiEsignLogo'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center ${className}`}>
      <img src={ctiEsignLogo} alt="CTI Official e-Signature" className="h-16 w-auto object-contain" />
    </div>
  )
}
