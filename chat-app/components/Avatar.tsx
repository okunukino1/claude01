interface AvatarProps {
  displayName: string
  avatarColor: string
  size?: 'sm' | 'md' | 'lg'
}

export function Avatar({ displayName, avatarColor, size = 'md' }: AvatarProps) {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' }
  const initial = displayName.charAt(0).toUpperCase()
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
      style={{ backgroundColor: avatarColor }}
    >
      {initial}
    </div>
  )
}
