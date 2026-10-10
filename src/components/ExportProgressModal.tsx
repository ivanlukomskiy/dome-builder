import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import type { DxfExportProgress } from '../lib/dxfExportRunner'
import type { StepExportProgress } from '../lib/stepExportRunner'

export type ExportKind = 'dxf' | 'step-parts' | 'step-assembly' | 'step-debug'
export type ExportPhase = DxfExportProgress['phase'] | StepExportProgress['phase']
export interface ExportSession {
  kind: ExportKind
  status: 'running' | 'completed' | 'failed'
  progress: { phase: ExportPhase; done: number; total: number }
  arrangeOnSheet: boolean
  error?: string
}

interface Props {
  session: ExportSession
  onCancel: () => void
  onClose: () => void
}

export function ExportProgressModal({ session, onCancel, onClose }: Props) {
  const { t } = useI18n()
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { buttonRef.current?.focus() }, [session.status])

  const phases: ExportPhase[] = session.kind === 'dxf'
    ? ['struts', 'flanges', 'braces', ...(session.arrangeOnSheet ? ['packing' as const] : []), 'writing']
    // A debug export builds one part, so it only ever shows the step that part is built in.
    : session.kind === 'step-debug' ? [session.progress.phase]
    : ['struts', 'flanges', 'braces', session.kind === 'step-parts' ? 'zipping' : 'writing']
  const labels: Record<ExportPhase, string> = {
    struts: t('Build struts'),
    flanges: t('Build flanges and feet'),
    braces: t('Build braces'),
    packing: t('Arrange parts on sheets'),
    writing: session.kind === 'dxf' ? t('Write DXF') : t('Write STEP'),
    zipping: t('Create ZIP archive'),
  }
  const title = session.kind === 'dxf' ? t('DXF export') : session.kind === 'step-parts' ? t('STEP parts export')
    : session.kind === 'step-debug' ? t('STEP debug export') : t('STEP assembly export')
  const activeIndex = phases.indexOf(session.progress.phase)

  return <div className="export-modal-backdrop">
    <section className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title" aria-describedby={session.status === 'running' ? undefined : 'export-modal-status'}>
      <h2 id="export-modal-title">{title}</h2>
      {session.status !== 'running' && <p id="export-modal-status" role="status" aria-live="polite">
        {session.status === 'completed' ? t('Export complete. Your download is ready.')
          : t('Export failed: {message}', { message: session.error ?? '' })}
      </p>}
      <ol className="export-modal-steps">
        {phases.map((phase, index) => {
          const completed = session.status === 'completed' || index < activeIndex
          const active = session.status === 'running' && index === activeIndex
          const indeterminate = active && phase === 'writing' && session.progress.total <= 0
          const percent = completed ? 100 : active && session.progress.total > 0
            ? Math.min(100, Math.round(100 * session.progress.done / session.progress.total)) : 0
          return <li key={phase} className={completed ? 'completed' : active ? 'active' : ''}>
            <div className="export-modal-step-heading">
              <span className="export-modal-step-icon" aria-hidden="true">{completed ? '✓' : index + 1}</span>
              <span>{labels[phase]}</span>
              <span className="export-modal-step-count">
                {completed ? t('Completed') : indeterminate ? t('Working…') : active && session.progress.total > 0
                  ? `${session.progress.done} / ${session.progress.total}` : ''}
              </span>
            </div>
            <div className={`export-modal-progress${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-label={labels[phase]} aria-valuenow={indeterminate ? undefined : percent} aria-valuetext={indeterminate ? t('Working…') : undefined} aria-valuemin={0} aria-valuemax={100}>
              <div style={indeterminate ? undefined : { width: `${percent}%` }} />
            </div>
          </li>
        })}
      </ol>
      <div className="export-modal-actions">
        {session.status === 'running'
          ? <button ref={buttonRef} onClick={onCancel}>{t('Cancel')}</button>
          : <button ref={buttonRef} onClick={onClose}>{t('Close')}</button>}
      </div>
    </section>
  </div>
}
