import { useTheme, applyTheme } from '@/lib/theme'
import { Moon, Sun, MonitorSmartphone } from 'lucide-react'

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme()

  const handleCycle = () => {
    // Cycle: dark → light → auto → dark
    const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark'
    setTheme(nextTheme)
  }

  const getIcon = () => {
    switch (theme) {
      case 'dark':
        return <Moon className="w-5 h-5" />
      case 'light':
        return <Sun className="w-5 h-5" />
      case 'auto':
        return <MonitorSmartphone className="w-5 h-5" />
    }
  }

  const getLabel = () => {
    switch (theme) {
      case 'dark':
        return 'Dark mode'
      case 'light':
        return 'Light mode'
      case 'auto':
        return 'System theme'
    }
  }

  return (
    <button
      onClick={handleCycle}
      aria-label={getLabel()}
      title={getLabel()}
      className="inline-flex items-center justify-center rounded-lg 
                 hover:bg-gray-800/50 light:hover:bg-gray-200/50 transition-all duration-200
                 ring-1 ring-gray-700/30 light:ring-gray-300/30 
                 hover:ring-primary-500/30 light:hover:ring-primary-400/30
                 w-10 h-10 p-2 text-gray-400 light:text-gray-600"
    >
      {getIcon()}
    </button>
  )
}
