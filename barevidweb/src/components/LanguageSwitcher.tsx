import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center justify-center p-2 text-white/60 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded transition-all"
      title={i18n.language === 'en' ? 'Switch to Chinese' : 'Switch to English'}
    >
      <Languages size={18} />
    </button>
  );
}
