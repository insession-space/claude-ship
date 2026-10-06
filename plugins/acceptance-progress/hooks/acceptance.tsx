// 作業中の Issue の受け入れ条件とチェックリストの進捗を、入力欄の上のバンドに出す mod。
// エージェントが gh で触った Issue の本文を GitHub から読み直し、済んだ数と残りの項目を描く。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lang, TrackedIssue } from '../types'
import type { IssueRef } from './checklist'
import {
  LABELS,
  bar,
  countItems,
  hasJapanese,
  isNotFound,
  issueFromJson,
  langFromSetting,
  mainGroups,
  parseCommandArg,
  refFromCommand,
  refFromUrl,
  viewArgv,
} from './checklist'

const issue = atom({ plugin: 'acceptance-progress', key: 'issue' } as const, null as TrackedIssue | null)
const isHidden = atom({ plugin: 'acceptance-progress', key: 'isHidden' } as const, false)
const lang = atom({ plugin: 'acceptance-progress', key: 'lang' } as const, null as Lang | null)

/** バンドに並べる未完了の項目の上限。残りは「ほか N 件」にまとめる */
const MAX_OPEN_ROWS = 3

// 最後に始めた取得の番号。再読み込みで 0 に戻るが、走っていた取得もそこで捨てられる
let latestFetch = 0

type Fetched = { kind: 'ok'; issue: TrackedIssue } | { kind: 'not-found' } | { kind: 'failed'; reason: string }

/** gh で本文を読み直す。gh が無い・未認証・ネットワーク失敗は failed、Issue が無いのは not-found。 */
const fetchIssue = async ($: EngineInterface, ref: IssueRef): Promise<Fetched> => {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(viewArgv(ref), { timeoutMs: 15_000 })
    if (exitCode !== 0) return isNotFound(stderr) ? { kind: 'not-found' } : { kind: 'failed', reason: stderr.trim() }
    const parsed = issueFromJson(stdout)
    return parsed === null ? { kind: 'failed', reason: 'unreadable output' } : { kind: 'ok', issue: parsed }
  } catch (err) {
    return { kind: 'failed', reason: String(err) }
  }
}

/**
 * Issue を読み直して表示を差し替える。Issue が無い・チェックリストが無いときは消し、
 * 読めなかったときは前回の表示を残して失敗の印を付ける。別の Issue へ切り替えようとして
 * 失敗したときも印を付け、残っている表示が最新ではないことを示す。
 */
const refresh = async ($: EngineInterface, ref: IssueRef): Promise<Fetched> => {
  // 取得は並んで走ることがある（並列の Bash 呼び出し、コマンドとエージェントの重なり）。
  // 後から始めた取得が先に終わったとき、先に始めた古い取得の結果で上書きしない
  const mine = ++latestFetch
  const got = await fetchIssue($, ref)
  if (mine !== latestFetch) return got
  await update($, issue, cur => {
    if (got.kind === 'ok') return got.issue.groups.length === 0 ? null : got.issue
    if (got.kind === 'not-found') return null
    return cur === null ? cur : { ...cur, error: got.reason }
  })

  return got
}

export const register: Register = on => {
  // settings の `language` が決まっていればそれを使い、無ければプロンプトの文字で決める
  let isLangFromSettings = false

  on('session.start', async ($, e, next) => {
    const fromSettings = langFromSetting((await $.settings.read()).language)
    isLangFromSettings = fromSettings !== null
    if (fromSettings !== null) await update($, lang, () => fromSettings)
    await $.command.register({
      name: 'acceptance',
      description: 'Show the acceptance criteria progress of a GitHub issue above the prompt',
      argumentHint: '[number | owner/repo#N | URL | off | on]',
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // ユーザーが打った文だけを見る（タスク通知などエンジン由来の文は英語で来る）
    const isUserText = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isUserText && !isLangFromSettings) await update($, lang, () => (hasJapanese(e.text) ? 'ja' : 'en'))

    return next(e)
  })

  on('command.run', { command: 'acceptance' }, async ($, e) => {
    const l = LABELS[(await read($, lang)) ?? 'en']
    const arg = parseCommandArg(e.args)
    if (arg.kind === 'usage') return { text: l.usage }
    if (arg.kind === 'off' || arg.kind === 'on') {
      await update($, isHidden, () => arg.kind === 'off')
      return { text: arg.kind === 'off' ? l.hidden : l.shown }
    }

    const cur = await read($, issue)
    const ref = arg.kind === 'show' ? arg.ref : cur === null ? null : { repo: cur.repo, number: cur.number }
    if (ref === null) return { text: l.none }
    await update($, isHidden, () => false)
    const got = await refresh($, ref)
    if (got.kind === 'not-found') return { text: l.notFound(ref.number) }
    if (got.kind === 'failed') return { text: l.fetchFailed(ref.number) }
    if (got.issue.groups.length === 0) return { text: l.noChecklist(ref.number) }
    const { done, total } = countItems(mainGroups(got.issue.groups))
    return { text: l.showing(ref.number, done, total) }
  })

  // メインエージェントが gh で触った Issue を読み直す。サブエージェントの呼び出しでは切り替えない
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined) return ran

    const created = /\bgh\s+issue\s+create\b/.test(e.command) ? refFromUrl(ran.text ?? '') : null
    const ref = refFromCommand(e.command) ?? created
    if (ref === null) return ran
    // リポジトリを書いていないコマンドが表示中と同じ番号を指すなら、表示中のリポジトリとみなす。
    // エージェントが別のディレクトリへ cd していても、セッションのカレントで読み違えないため
    const cur = await read($, issue)
    await refresh($, ref.repo === null && cur?.number === ref.number ? { ...ref, repo: cur.repo } : ref)

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cur = await read($, issue)
    if (e.props.hasSurvey || cur === null || (await read($, isHidden))) return next(e)

    // 他のプラグイン（agent-cast や ship-session のバンド）が描くものの下に並べる
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const l = LABELS[(await read($, lang)) ?? 'en']
    const main = mainGroups(cur.groups)
    const others = cur.groups.filter(g => !main.includes(g))
    const { done, total } = countItems(main)
    const open = main.flatMap(g => g.items).filter(i => !i.isDone)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Box justifyContent="space-between" columnGap={2}>
            <Text bold wrap="truncate-end">
              #{cur.number} {cur.title}
            </Text>
            <Box flexShrink={0}>
              <Text>
                <Text dimColor>{main[0]?.isAcceptance === true ? l.acceptance : l.other} </Text>
                <Text color="green">{bar(done, total, 12)}</Text> <Text bold>{done}/{total}</Text>
              </Text>
            </Box>
          </Box>
          {open.length === 0 ? (
            <Text color="green">✔ {l.allDone}</Text>
          ) : (
            open.slice(0, MAX_OPEN_ROWS).map(i => (
              <Text wrap="truncate-end">
                <Text dimColor>○ </Text>
                {i.text}
              </Text>
            ))
          )}
          {open.length > MAX_OPEN_ROWS && <Text dimColor>{l.more(open.length - MAX_OPEN_ROWS)}</Text>}
          {others.length > 0 && (
            <Text dimColor wrap="truncate-end">
              {others
                .map(g => {
                  const c = countItems([g])
                  return `${g.heading ?? l.noHeading} ${c.done}/${c.total}`
                })
                .join('  ·  ')}
            </Text>
          )}
          {cur.error !== null && <Text color="yellow">⚠ {l.failed}</Text>}
        </Box>
      </Box>
    )
  })
}
