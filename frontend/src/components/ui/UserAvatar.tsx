import { useState } from 'react'
import { clsx } from 'clsx'

// Account logo: renders the user's avatar image when one is set, otherwise a
// gradient circle with the username's initial. Falls back to the initial if
// the image fails to load (offline / deleted URL).
export default function UserAvatar({
  user,
  size = 32,
  className = '',
}: {
  user?: { username?: string; full_name?: string; avatar_url?: string } | null
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const initial = ((user?.username || user?.full_name || '?')[0] || '?').toUpperCase()
  const url = user?.avatar_url && !broken ? user.avatar_url : null

  if (url) {
    return (
      <img
        src={url}
        alt={`${user?.username || ''} avatar`}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={clsx('rounded-full object-cover flex-shrink-0', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={clsx(
        'rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold flex-shrink-0',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
    >
      {initial}
    </div>
  )
}