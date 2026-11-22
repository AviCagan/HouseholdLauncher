import { Icon, type IconName } from '@/components/primitives/Icon'
import { openSheet, type MkSheet } from './store'
import { S } from './strings'
import { Row, Section } from './ui'
import { useHer } from './useMikvah'

const M = S.more

export function MoreTab() {
  const { result, contacts, trips } = useHer()
  const open = (sheet: MkSheet) => () => openSheet(sheet)
  const item = (icon: IconName, label: string, sheet: MkSheet, hint?: string) => (
    <Row key={label} onClick={open(sheet)}>
      <Icon name={icon} size={18} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium">{label}</span>
        {hint && <span className="mk-faint block text-[12px]">{hint}</span>}
      </span>
    </Row>
  )
  const kavua = result?.flags.filter((f) => (f.ruleId === 'K1' || f.ruleId === 'K2') && f.ruling === null).length ?? 0

  return (
    <div className="pb-8">
      <Section title="Records">
        {item('history', M.events, { kind: 'events' }, 'Stains, pregnancy, birth, nursing and more')}
        {item('globe', M.trips, { kind: 'trips' }, trips.length ? `${trips.length} trip${trips.length === 1 ? '' : 's'}` : undefined)}
        {item('pencil', M.memos, { kind: 'memos' })}
        {item('repeat', M.kavua, { kind: 'kavua' }, kavua ? `${kavua} possible pattern${kavua === 1 ? '' : 's'} to ask about` : undefined)}
      </Section>
      <Section title="Your rav">
        {item('people', M.contacts, { kind: 'contacts' }, contacts.length ? undefined : 'Empty until you add one')}
        {item('file', M.share, { kind: 'share' })}
      </Section>
      <Section title="Print">{item('calendar', M.print, { kind: 'print' })}</Section>
      <Section title="The app">
        {item('book', M.help, { kind: 'help' })}
        {item('link', M.sources, { kind: 'sources' })}
        {item('people', M.partner, { kind: 'partner' })}
        {item('settings', M.settings, { kind: 'settings' })}
        {item('copy', M.export, { kind: 'export' })}
      </Section>
    </div>
  )
}
