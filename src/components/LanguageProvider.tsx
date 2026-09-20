import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTranslator, I18nContext, loadLang, saveLang, type Lang } from '../lib/i18n'

// Holds the current UI language (restored from the last visit) and hands `t` / `tn` /
// `setLang` down to every component through useI18n.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang)

  const translator = useMemo(
    () =>
      createTranslator(lang, (next) => {
        setLangState(next)
        saveLang(next)
      }),
    [lang],
  )

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>
}
