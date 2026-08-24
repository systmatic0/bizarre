import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Camera, Home, Menu, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { scrollAppToTop } from './scrollToTop'
import '../styles/Navbar.css'

type NavItem = {
	id: string
	type: 'internal' | 'external'
	to: string
	label: string
	icon: LucideIcon
}

const navItems: NavItem[] = [
	{ id: 'home', type: 'internal', to: '/', label: 'Home', icon: Home },
	{ id: 'photos', type: 'internal', to: '/shots', label: 'Photos', icon: Camera },
]

function Navbar() {
	const location = useLocation()
	const [navElement, setNavElement] = useState<HTMLDivElement | null>(null)
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
	const [isExpanded, setIsExpanded] = useState(false)
	const [isInteractionReady, setIsInteractionReady] = useState(false)
	const openInteractionTimeoutRef = useRef<number | null>(null)
	const autoCloseTimeoutRef = useRef<number | null>(null)
	const ignoreToggleClickRef = useRef(false)
	const [isMobile, setIsMobile] = useState(() => {
		if (typeof window === 'undefined') {
			return false
		}

		return window.matchMedia('(max-width: 640px)').matches
	})

	useEffect(() => {
		const mediaQuery = window.matchMedia('(max-width: 640px)')

		const handleChange = (event: MediaQueryListEvent) => {
			setIsMobile(event.matches)
			setIsExpanded(false)
			setIsInteractionReady(false)
			setHoveredIndex(null)
		}

		mediaQuery.addEventListener('change', handleChange)

		return () => {
			if (openInteractionTimeoutRef.current !== null) {
				window.clearTimeout(openInteractionTimeoutRef.current)
			}

			if (autoCloseTimeoutRef.current !== null) {
				window.clearTimeout(autoCloseTimeoutRef.current)
			}

			mediaQuery.removeEventListener('change', handleChange)
		}
	}, [])

	const clearAutoCloseTimeout = () => {
		if (autoCloseTimeoutRef.current === null) {
			return
		}

		window.clearTimeout(autoCloseTimeoutRef.current)
		autoCloseTimeoutRef.current = null
	}

	useEffect(() => {
		if (openInteractionTimeoutRef.current !== null) {
			window.clearTimeout(openInteractionTimeoutRef.current)
			openInteractionTimeoutRef.current = null
		}

		if (!isMobile) {
			setIsInteractionReady(true)
			return
		}

		if (!isExpanded) {
			setIsInteractionReady(false)
			return
		}

		setIsInteractionReady(false)
		openInteractionTimeoutRef.current = window.setTimeout(() => {
			setIsInteractionReady(true)
			openInteractionTimeoutRef.current = null
		}, 220)

		return () => {
			if (openInteractionTimeoutRef.current !== null) {
				window.clearTimeout(openInteractionTimeoutRef.current)
				openInteractionTimeoutRef.current = null
			}
		}
	}, [isExpanded, isMobile])

	const toggleNavigation = () => {
		setHoveredIndex(null)
		setIsExpanded((current) => !current)
	}

	const collapseNavigation = () => {
		clearAutoCloseTimeout()
		setHoveredIndex(null)
		setIsExpanded(false)
		setIsInteractionReady(false)

		if (navElement && document.activeElement instanceof HTMLElement && navElement.contains(document.activeElement)) {
			document.activeElement.blur()
		}
	}

	const scheduleAutoClose = () => {
		if (!isMobile || !isExpanded) {
			return
		}

		clearAutoCloseTimeout()
		autoCloseTimeoutRef.current = window.setTimeout(() => {
			collapseNavigation()
			autoCloseTimeoutRef.current = null
		}, 2000)
	}

	useEffect(() => {
		if (navElement && document.activeElement instanceof HTMLElement && navElement.contains(document.activeElement)) {
			document.activeElement.blur()
		}

		const frame = window.requestAnimationFrame(() => {
			if (!navElement || isMobile) {
				setHoveredIndex(null)
				setIsExpanded(false)
				setIsInteractionReady(false)
				return
			}

			const hoveredItem = navElement.querySelector<HTMLElement>('.floating-nav-item:hover')

			if (hoveredItem) {
				const nextHoveredIndex = Number(hoveredItem.dataset.navIndex)
				setHoveredIndex(Number.isNaN(nextHoveredIndex) ? null : nextHoveredIndex)
				setIsExpanded(true)
				return
			}

			setHoveredIndex(null)
			setIsExpanded(navElement.matches(':hover'))
		})

		return () => {
			window.cancelAnimationFrame(frame)
		}
	}, [isMobile, location.pathname, navElement])

	useEffect(() => {
		if (!isMobile || !isExpanded || !navElement) {
			clearAutoCloseTimeout()
			return
		}

		scheduleAutoClose()

		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && navElement.contains(event.target)) {
				return
			}

			collapseNavigation()
		}

		document.addEventListener('pointerdown', handlePointerDown, true)

		return () => {
			clearAutoCloseTimeout()
			document.removeEventListener('pointerdown', handlePointerDown, true)
		}
	}, [isExpanded, isMobile, navElement])

	const highlightedIndex = isMobile ? -1 : (hoveredIndex ?? -1)
	const menuStyle = {
		'--floating-nav-item-count': navItems.length,
		'--hover-position': highlightedIndex >= 0 ? highlightedIndex : 0,
	} as CSSProperties

	return (
		<nav className='floating-nav' aria-label='Primary' style={menuStyle}>
			<div
				ref={setNavElement}
				className={`floating-nav-container${isExpanded ? ' is-expanded' : ''}${isInteractionReady ? ' is-interaction-ready' : ''}`}
				onPointerDownCapture={() => {
					if (!isMobile || !isExpanded) {
						return
					}

					scheduleAutoClose()
				}}
				onMouseEnter={() => {
					if (isMobile) {
						return
					}

					setIsExpanded(true)
					setIsInteractionReady(true)
				}}
				onMouseLeave={() => {
					if (isMobile) {
						return
					}

					setHoveredIndex(null)
					setIsExpanded(false)
					setIsInteractionReady(false)
				}}
			>
				<button
					type='button'
					className='floating-nav-toggle'
					aria-label='Toggle navigation'
					aria-expanded={isExpanded}
					onPointerDown={(event) => {
						if (!isMobile) {
							return
						}

						event.preventDefault()
						event.stopPropagation()
						ignoreToggleClickRef.current = true

						if (isExpanded) {
							collapseNavigation()
							return
						}

						toggleNavigation()
					}}
					onClick={() => {
						if (ignoreToggleClickRef.current) {
							ignoreToggleClickRef.current = false
							return
						}

						toggleNavigation()
					}}
				>
					<Menu className='floating-nav-icon' aria-hidden='true' strokeWidth={1.75} />
				</button>

				<div
					className='floating-nav-menu-items'
					data-hover={highlightedIndex >= 0 ? 'true' : undefined}
					onMouseLeave={() => {
						if (isMobile) {
							return
						}

						setHoveredIndex(null)
					}}
				>
					{navItems.map(({ id, type, to, label, icon: Icon }, index) => {
						const handleEnter = () => {
							if (isMobile) {
								return
							}

							setHoveredIndex(index)
							setIsExpanded(true)
						}

						const handleFocus = () => {
							if (isMobile) {
								return
							}

							handleEnter()
						}

						const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
							if (isMobile && !isInteractionReady) {
								event.preventDefault()
								event.stopPropagation()
								return
							}

							// Tapping the page you're already on stays interactive: the
							// router would no-op, so send the reader back to the top instead.
							if (type === 'internal' && location.pathname === to) {
								event.preventDefault()
								scrollAppToTop()
							}

							if (isMobile) {
								setHoveredIndex(null)
								setIsExpanded(false)
								setIsInteractionReady(false)
							}
						}

						const sharedProps = {
							className: ['floating-nav-item', !isMobile && hoveredIndex === index ? 'is-hovered' : ''].filter(Boolean).join(' '),
							'aria-label': label,
							onMouseEnter: handleEnter,
							onFocus: handleFocus,
							onBlur: () => setHoveredIndex(null),
							onClick: handleClick,
						}

						if (type === 'external') {
							return (
								<a
									key={id}
									href={to}
									target='_blank'
									rel='noopener noreferrer'
									data-nav-index={index}
									{...sharedProps}
								>
									<Icon className='floating-nav-icon' aria-hidden='true' strokeWidth={1.75} />
									<span className='floating-nav-item-label'>{label}</span>
								</a>
							)
						}

						return (
							<NavLink
								key={id}
								to={to}
								className={sharedProps.className}
								data-nav-index={index}
								aria-label={sharedProps['aria-label']}
								onMouseEnter={sharedProps.onMouseEnter}
								onFocus={sharedProps.onFocus}
								onBlur={sharedProps.onBlur}
								onClick={sharedProps.onClick}
							>
								<Icon className='floating-nav-icon' aria-hidden='true' strokeWidth={1.75} />
								<span className='floating-nav-item-label'>{label}</span>
							</NavLink>
						)
					})}
				</div>
			</div>
		</nav>
	)
}

export default Navbar
