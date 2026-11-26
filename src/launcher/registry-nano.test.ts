import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APPS } from './registry'
import { TABLES } from '@/data/adapter'

/*
  Every app comes with Nano access planned as part of it. The registry says
  which tables are each app's; 029_nano.sql's nano_tables() is what the
  database actually covers with Nano's rules, change log and refusals. They
  must agree, or a new app ships with tables Nano either can't reach or
  reaches without a log.
*/
const sql = readFileSync(resolve(__dirname, '../../supabase/029_nano.sql'), 'utf8')

function sqlNanoTables(): Map<string, string> {
  const body = sql.slice(sql.indexOf('create or replace function nano_tables()'))
  const values = body.slice(0, body.indexOf('$$;', body.indexOf('values')))
  const rows = [...values.matchAll(/\('([a-z_]+)',\s*'([a-z]+)',/g)]
  return new Map(rows.map((m) => [m[1], m[2]]))
}

describe('Nano access for every app', () => {
  const covered = sqlNanoTables()

  it('reads the table list out of the migration', () => {
    expect(covered.size).toBeGreaterThan(20)
    expect(covered.get('todos')).toBe('things')
  })

  it('has a Nano section on every app', () => {
    for (const app of APPS) {
      expect(app.nano, app.id).toBeDefined()
      expect(app.nano.tables.length, app.id).toBeGreaterThan(0)
    }
  })

  it("covers every app table in the database's Nano rules, under the right app", () => {
    for (const app of APPS) {
      if (app.nano.private) continue // the Calendar has rules of its own
      for (const table of app.nano.tables) {
        expect(covered.get(table), `${app.id}: ${table}`).toBe(app.id)
      }
    }
  })

  it('has no table in the database rules that no app claims', () => {
    const claimed = new Set(APPS.flatMap((a) => a.nano.tables))
    for (const table of covered.keys()) expect(claimed.has(table), table).toBe(true)
  })

  it('names only tables the app actually syncs', () => {
    const synced = new Set<string>(TABLES)
    for (const app of APPS) for (const table of app.nano.tables) expect(synced.has(table), table).toBe(true)
  })

  it('keeps friends out of the apps that say never', () => {
    const never = APPS.filter((a) => a.nano.friends === 'never' && !a.nano.private).map((a) => a.id)
    const blocked = sql.match(/if app in \(([^)]+)\) then return false; end if;/)
    expect(blocked, 'the friends block in nano_reach').not.toBeNull()
    for (const id of never) expect(blocked![1]).toContain(`'${id}'`)
  })

  it('keeps friends to reading in the apps that say own-read', () => {
    for (const app of APPS.filter((a) => a.nano.friends === 'own-read')) {
      expect(sql).toContain(`if writing and app = '${app.id}' then return false; end if;`)
    }
  })

  it('never saves a request from the private app', () => {
    for (const app of APPS.filter((a) => a.nano.private)) {
      expect(sql).toContain(`check (app_id <> '${app.id}')`)
    }
  })
})
