'use client'

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'よく使う', emojis: ['😀','😂','😊','😍','🥰','😎','🤔','😢','😭','😡','👍','👎','🙏','👏','🎉','❤️','🔥','✨','💯','✅'] },
  { label: '顔', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','🤪','🤨','😐','😶','😏','😒','🙄','😬','😴','😪','😷','🤒','🤕','🤧','🥵','🥶','😵','🤯','🤠','😎'] },
  { label: 'ジェスチャー', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙌','👐','🙏','💪','👈','👉','👆','👇','✋','🤚','👋','🤝'] },
  { label: 'シンボル', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💕','💯','🔥','✨','⭐','🌟','💫','⚡','💥','🎉','🎊','✅','❌','⭕','❗','❓','💤','💢'] },
  { label: 'モノ', emojis: ['📌','📎','✏️','📝','📅','📁','💼','📞','📱','💻','⏰','🔔','🔒','🔑','💡','🎁','🏆','🎯','💰','📊'] },
]

export function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-40 w-[280px] sm:w-[320px] max-h-72 overflow-y-auto p-2">
        {EMOJI_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="text-[10px] text-gray-400 font-medium px-1 mb-1 sticky top-0 bg-white">{group.label}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {group.emojis.map((emoji, i) => (
                <button
                  key={`${group.label}-${i}`}
                  onClick={() => onSelect(emoji)}
                  className="text-xl p-1 hover:bg-gray-100 rounded-lg active:scale-110 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
