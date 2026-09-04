import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath'

type LogoProps = {
  className?: string
}

function Logo({ className }: LogoProps) {
  return (
    <svg xmlns='http://www.w3.org/2000/svg' viewBox={LOGO_VIEWBOX} className={className}>
      <path fill='var(--logo)' d={LOGO_PATH} />
    </svg>
  )
}

export default Logo
