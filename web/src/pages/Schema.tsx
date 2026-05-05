import { useEffect, useMemo, useState } from 'react'
import { Layout, PageBody, PageHeader } from '../components/Layout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { api, type Schema, type SchemaAttribute, type SchemaObjectClass } from '../lib/api'

type Tab = 'attributes' | 'classes'

export function SchemaPage() {
  const toast = useToast()
  const [schema, setSchema] = useState<Schema | null>(null)
  const [tab, setTab] = useState<Tab>('attributes')
  const [q, setQ] = useState('')
  const [selectedAttr, setSelectedAttr] = useState<SchemaAttribute | null>(null)
  const [selectedClass, setSelectedClass] = useState<SchemaObjectClass | null>(null)

  const load = async () => {
    try {
      const sch = await api.getSchema()
      setSchema(sch)
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const refresh = async () => {
    try {
      await api.refreshSchema()
      setSchema(null)
      load()
      toast.ok('schema cache refreshed')
    } catch (e) {
      toast.err((e as Error).message)
    }
  }

  const filteredAttrs = useMemo(() => {
    if (!schema) return []
    if (!q) return schema.attributes
    const ql = q.toLowerCase()
    return schema.attributes.filter(
      (a) =>
        a.names.some((n) => n.toLowerCase().includes(ql)) ||
        a.description.toLowerCase().includes(ql) ||
        a.oid.includes(ql)
    )
  }, [schema, q])

  const filteredClasses = useMemo(() => {
    if (!schema) return []
    if (!q) return schema.objectClasses
    const ql = q.toLowerCase()
    return schema.objectClasses.filter(
      (c) =>
        c.names.some((n) => n.toLowerCase().includes(ql)) ||
        c.description.toLowerCase().includes(ql) ||
        c.must?.some((m) => m.toLowerCase().includes(ql)) ||
        c.may?.some((m) => m.toLowerCase().includes(ql)) ||
        c.oid.includes(ql)
    )
  }, [schema, q])

  return (
    <Layout>
      <PageHeader
        title="Schema"
        subtitle={
          schema
            ? `${schema.attributes.length} attributes · ${schema.objectClasses.length} object classes`
            : 'loading...'
        }
        actions={
          <Button variant="ghost" onClick={refresh}>
            refresh cache
          </Button>
        }
      />
      <PageBody>
        {/* Tabs */}
        <div className="flex border-b border-ink-700 mb-4">
          <TabBtn active={tab === 'attributes'} onClick={() => setTab('attributes')}>
            attributes ({schema?.attributes.length ?? '…'})
          </TabBtn>
          <TabBtn active={tab === 'classes'} onClick={() => setTab('classes')}>
            object classes ({schema?.objectClasses.length ?? '…'})
          </TabBtn>
        </div>

        {/* Search */}
        <div className="mb-4">
          <Input
            placeholder={
              tab === 'attributes'
                ? 'search by name, OID, or description...'
                : 'search by name, OID, must/may...'
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
            mono
          />
        </div>

        {!schema ? (
          <div className="label-mono p-8">// loading schema...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* List */}
            <div className="lg:col-span-2">
              <div className="panel overflow-hidden">
                {tab === 'attributes' ? (
                  <AttrTable
                    attrs={filteredAttrs}
                    selected={selectedAttr}
                    onSelect={(a) => {
                      setSelectedAttr(a)
                      setSelectedClass(null)
                    }}
                  />
                ) : (
                  <ClassTable
                    classes={filteredClasses}
                    selected={selectedClass}
                    onSelect={(c) => {
                      setSelectedClass(c)
                      setSelectedAttr(null)
                    }}
                  />
                )}
              </div>
              {(tab === 'attributes' ? filteredAttrs : filteredClasses).length === 0 && (
                <div className="label-mono py-8 text-center">// no matches</div>
              )}
            </div>

            {/* Detail */}
            <div className="lg:sticky lg:top-4 self-start">
              {selectedAttr && <AttrDetail attr={selectedAttr} schema={schema} />}
              {selectedClass && <ClassDetail cls={selectedClass} schema={schema} />}
              {!selectedAttr && !selectedClass && (
                <div className="panel p-6 text-center text-sm text-ink-500 font-mono">
                  // pick a row to see details
                </div>
              )}
            </div>
          </div>
        )}
      </PageBody>
    </Layout>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-mono transition-colors border-b-2 -mb-px ${
        active
          ? 'border-amber text-ink-100'
          : 'border-transparent text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}

function AttrTable({
  attrs,
  selected,
  onSelect,
}: {
  attrs: SchemaAttribute[]
  selected: SchemaAttribute | null
  onSelect: (a: SchemaAttribute) => void
}) {
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-900 border-b border-ink-700">
          <tr>
            <Th>name</Th>
            <Th>oid</Th>
            <Th>flags</Th>
          </tr>
        </thead>
        <tbody>
          {attrs.map((a) => {
            const isSelected = selected?.oid === a.oid
            return (
              <tr
                key={a.oid}
                onClick={() => onSelect(a)}
                className={`cursor-pointer border-b border-ink-700 last:border-0 transition-colors ${
                  isSelected ? 'bg-amber/10' : 'hover:bg-ink-800/50'
                }`}
              >
                <Td>
                  <span className="font-mono text-amber">{a.names[0] || '—'}</span>
                  {a.names.length > 1 && (
                    <span className="text-xs text-ink-500 font-mono ml-2">
                      ({a.names.slice(1).join(', ')})
                    </span>
                  )}
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-500">{a.oid}</span>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {a.singleValue && <Pill>SINGLE</Pill>}
                    {a.noUserMod && <Pill>READONLY</Pill>}
                    {a.usage && a.usage !== 'userApplications' && <Pill>{a.usage}</Pill>}
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ClassTable({
  classes,
  selected,
  onSelect,
}: {
  classes: SchemaObjectClass[]
  selected: SchemaObjectClass | null
  onSelect: (c: SchemaObjectClass) => void
}) {
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-900 border-b border-ink-700">
          <tr>
            <Th>name</Th>
            <Th>kind</Th>
            <Th>must</Th>
            <Th>may</Th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => {
            const isSelected = selected?.oid === c.oid
            return (
              <tr
                key={c.oid}
                onClick={() => onSelect(c)}
                className={`cursor-pointer border-b border-ink-700 last:border-0 transition-colors ${
                  isSelected ? 'bg-amber/10' : 'hover:bg-ink-800/50'
                }`}
              >
                <Td>
                  <span className="font-mono text-amber">{c.names[0] || '—'}</span>
                </Td>
                <Td>
                  <Pill>{c.kind}</Pill>
                </Td>
                <Td className="text-xs text-ink-500 font-mono">{c.must?.length ?? 0}</Td>
                <Td className="text-xs text-ink-500 font-mono">{c.may?.length ?? 0}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AttrDetail({ attr, schema }: { attr: SchemaAttribute; schema: Schema }) {
  // Hangi objectClass'larda kullanılıyor?
  const usedIn = useMemo(() => {
    const out: { class: string; required: boolean }[] = []
    const aliases = new Set(attr.names.map((n) => n.toLowerCase()))
    for (const c of schema.objectClasses) {
      const must = c.must?.some((m) => aliases.has(m.toLowerCase()))
      const may = c.may?.some((m) => aliases.has(m.toLowerCase()))
      if (must || may) {
        out.push({ class: c.names[0] || c.oid, required: !!must })
      }
    }
    return out
  }, [attr, schema])

  return (
    <div className="panel p-5 space-y-3 text-sm">
      <div>
        <div className="label-mono mb-1">attribute</div>
        <div className="font-mono text-amber text-base">{attr.names[0]}</div>
        {attr.names.length > 1 && (
          <div className="text-xs text-ink-500 font-mono mt-0.5">
            aliases: {attr.names.slice(1).join(', ')}
          </div>
        )}
      </div>

      {attr.description && (
        <Field label="description">
          <span className="text-ink-300">{attr.description}</span>
        </Field>
      )}

      <Field label="oid">
        <span className="font-mono text-xs">{attr.oid}</span>
      </Field>

      {attr.syntax && (
        <Field label="syntax">
          <span className="font-mono text-xs">{attr.syntax}</span>
        </Field>
      )}
      {attr.equality && (
        <Field label="equality">
          <span className="font-mono text-xs">{attr.equality}</span>
        </Field>
      )}
      {attr.substring && (
        <Field label="substring">
          <span className="font-mono text-xs">{attr.substring}</span>
        </Field>
      )}
      {attr.superType && (
        <Field label="parent attribute">
          <span className="font-mono text-xs text-amber">{attr.superType}</span>
        </Field>
      )}

      {(attr.singleValue || attr.noUserMod || attr.usage) && (
        <Field label="flags">
          <div className="flex flex-wrap gap-1">
            {attr.singleValue && <Pill>SINGLE-VALUE</Pill>}
            {attr.noUserMod && <Pill>NO-USER-MODIFICATION</Pill>}
            {attr.usage && attr.usage !== 'userApplications' && <Pill>{attr.usage}</Pill>}
          </div>
        </Field>
      )}

      {usedIn.length > 0 && (
        <Field label={`used in ${usedIn.length} classes`}>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {usedIn.map((u) => (
              <span
                key={u.class}
                className={`text-[10px] font-mono px-1.5 py-0.5 border ${
                  u.required
                    ? 'text-amber border-amber/50'
                    : 'text-ink-300 border-ink-700'
                }`}
                title={u.required ? 'required (MUST)' : 'optional (MAY)'}
              >
                {u.class}
                {u.required && '*'}
              </span>
            ))}
          </div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">
            * = required (MUST)
          </div>
        </Field>
      )}
    </div>
  )
}

function ClassDetail({ cls, schema }: { cls: SchemaObjectClass; schema: Schema }) {
  // Inheritance chain'i takip et: parent'lardan da MUST/MAY alanları gelir
  return (
    <div className="panel p-5 space-y-3 text-sm">
      <div>
        <div className="label-mono mb-1">object class</div>
        <div className="font-mono text-amber text-base">{cls.names[0]}</div>
        {cls.names.length > 1 && (
          <div className="text-xs text-ink-500 font-mono mt-0.5">
            aliases: {cls.names.slice(1).join(', ')}
          </div>
        )}
      </div>

      {cls.description && (
        <Field label="description">
          <span className="text-ink-300">{cls.description}</span>
        </Field>
      )}

      <Field label="kind">
        <Pill>{cls.kind}</Pill>
      </Field>

      <Field label="oid">
        <span className="font-mono text-xs">{cls.oid}</span>
      </Field>

      {cls.superClass && cls.superClass.length > 0 && (
        <Field label="extends">
          <div className="flex flex-wrap gap-1">
            {cls.superClass.map((s) => (
              <span
                key={s}
                className="text-[10px] font-mono px-1.5 py-0.5 border border-amber/50 text-amber"
              >
                {s}
              </span>
            ))}
          </div>
        </Field>
      )}

      {cls.must && cls.must.length > 0 && (
        <Field label={`required (${cls.must.length})`}>
          <div className="flex flex-wrap gap-1">
            {cls.must.map((m) => (
              <span key={m} className="text-[10px] font-mono px-1.5 py-0.5 border border-amber/50 text-amber">
                {m}
              </span>
            ))}
          </div>
        </Field>
      )}

      {cls.may && cls.may.length > 0 && (
        <Field label={`optional (${cls.may.length})`}>
          <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
            {cls.may.map((m) => (
              <span key={m} className="text-[10px] font-mono px-1.5 py-0.5 border border-ink-700 text-ink-300">
                {m}
              </span>
            ))}
          </div>
        </Field>
      )}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="label-mono mb-1">{label}</div>
      <div>{children}</div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-ink-300 bg-ink-800 border border-ink-700 px-1.5 py-0.5">
      {children}
    </span>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="label-mono text-left px-4 py-2.5">{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>
}
