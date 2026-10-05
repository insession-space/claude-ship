// ship-band.tsx（プロンプト上のバンド）のテスト。`claude plugin test plugins/ship-session` で走る。
// テストの `on` で登録したフックはプラグインの下に入り、エンジン（ツールの実行結果）の代わりをする。
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { langFromSetting } from '../hooks/ship-progress'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const GOAL_SCRIPT = '/plugins/ship-session/hooks/ship-goal.sh'

/** Bash の結果を、コマンドごとに決めた標準出力で返す（エンジンの代わり）。 */
const answerBash = (on: On, outputs: Record<string, { stdout: string; isError?: boolean }>) => {
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const hit = Object.entries(outputs).find(([prefix]) => e.command.startsWith(prefix))
    const out = hit?.[1] ?? { stdout: '' }
    return {
      result: { stdout: out.stdout, stderr: '', interrupted: false },
      text: out.stdout,
      ...(out.isError === true && { isError: true }),
    }
  })
}

const answerSkills = (on: On) => {
  on('tool.call', { tool: 'Skill' }, (_$, e) => ({
    result: { success: true, commandName: e.skill },
    text: `Launching skill: ${e.skill}`,
  }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
}

/** バンドの下でエンジンが描くもの（何も出さない）。バンドはこの描画の下に自分を並べる。 */
const answerEngineBand = (on: On) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
const skill = ($: Engine, name: string) => $.tool.call({ tool: 'Skill', skill: name })
const typed = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

/** バンドに描かれた文字を、要素の順に1本の文字列にする。 */
const bandText = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const ui = await $.ui.mount({ plugin: 'ship-session', surface, component: 'AbovePrompt', props: PROPS })
  const texts = await ui.findAll({ type: 'Text' })
  return texts.map(t => t.text).join(' | ')
}

describe('language 設定の判定', () => {
  test('日本語の値だけを ja にする', () => {
    for (const v of ['ja', 'ja-JP', 'JA_jp', '日本語', '日本', 'Japanese', ' japanese ']) {
      expect(langFromSetting(v), v).toBe('ja')
    }
    for (const v of ['Javanese', 'jav', 'English', 'en-US']) {
      expect(langFromSetting(v), v).toBe('en')
    }
    expect(langFromSetting('')).toBe(null)
    expect(langFromSetting(undefined)).toBe(null)
  })
})

describe('ship-session のバンド', () => {
  for (const surface of SURFACES) {
    test(`${surface}: ship-session を起動していなければ何も描かない`, async ($, on) => {
      answerBash(on, {})
      answerSkills(on)
      // バンドを譲ったときにエンジンが描くもの
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })
      await bash($, 'gh issue create --title x --body y')
      expect(await bandText($, surface)).toBe('engine')
    })

    test(`${surface}: 下で描かれたバンド（他のプラグインやエンジン）の下に並べる`, async ($, on) => {
      answerSkills(on)
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>other band</Text>
      })
      await skill($, 'ship-session:ship-session')
      const text = await bandText($, surface)
      expect(text.startsWith('other band | ')).toBe(true)
      expect(text).toContain('▶ Goal')
    })

    test(`${surface}: 到達点 → Issue → 実装ループ → PR の順に表示が変わる`, async ($, on) => {
      answerBash(on, {
        [`${GOAL_SCRIPT} record`]: { stdout: 'Recorded the goal: Up to PR' },
        'gh issue create': { stdout: 'https://github.com/acme/app/issues/42\n' },
        'gh pr create': { stdout: 'https://github.com/acme/app/pull/43\n' },
      })
      answerSkills(on)
      answerEngineBand(on)

      // ユーザーがスラッシュコマンドで起動した場合（Skill ツールを通らない）
      await typed($, '/ship-session:ship-session make the search faster')
      expect(await bandText($, surface)).toContain('▶ Goal')

      await bash($, `${GOAL_SCRIPT} record "Up to PR"`)
      await skill($, 'ship-session:create-issue')
      let text = await bandText($, surface)
      expect(text).toContain('Up to PR')
      expect(text).toContain('✔ Goal')
      expect(text).toContain('▶ Issue')

      await bash($, 'gh issue create --title x --body-file b.md')
      await skill($, 'ship-session:issue-loop')
      await skill($, 'ship-session:code-review')
      await skill($, 'ship-session:code-review')
      text = await bandText($, surface)
      expect(text).toContain('#42')
      expect(text).toContain('▶ Implementation loop')
      expect(text).toContain('2 reviews')

      await bash($, 'gh pr create --draft --title x --body y')
      expect(await bandText($, surface)).toContain('#43')
    })

    test(`${surface}: gh issue create が失敗したら Issue 番号を出さない`, async ($, on) => {
      answerBash(on, {
        'gh issue create': { stdout: 'could not create issue: HTTP 403', isError: true },
        'gh pr create': { stdout: 'no URL in this output' },
      })
      answerSkills(on)
      answerEngineBand(on)

      await skill($, 'ship-session:ship-session')
      await bash($, 'gh issue create --title x --body y')
      await bash($, 'gh pr create --title x --body y')
      const text = await bandText($, surface)
      expect(text).not.toMatch(/#\d/)
      expect(text).toContain('not yet')
    })

    test(`${surface}: ゲートがツールを止めたら理由を出し、到達点が決まったら消す`, async ($, on) => {
      answerBash(on, { [`${GOAL_SCRIPT} record`]: { stdout: 'Recorded the goal: Up to PR' } })
      answerSkills(on)
      answerEngineBand(on)
      on('tool.call', { tool: 'Read' }, () => ({ result: 'unused', text: 'unused' }))
      // ship-gate.py が exit 2 で止めたときと同じ形（classic の PreToolUse の block）
      on('classic.PreToolUse', (_$, e, next) =>
        e.tool === 'Read' ? { deny: '[ship-gate] The goal is not decided yet.' } : next(e),
      )

      await skill($, 'ship-session:ship-session')
      const ran = await $.tool.call({ tool: 'Read', file_path: '/tmp/x' })
      expect(ran.deny ?? ran.text).toContain('[ship-gate]')
      expect(await bandText($, surface)).toContain('Stopped Read because the goal is not decided yet')

      await bash($, `${GOAL_SCRIPT} record "Up to PR"`)
      expect(await bandText($, surface)).not.toContain('Stopped Read')
    })

    test(`${surface}: 到達点の質問の回答と、日本語のプロンプトで表示を切り替える`, async ($, on) => {
      answerSkills(on)
      answerEngineBand(on)
      on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({
        result: { questions: e.questions, answers: { 'どこまで進めますか？': 'PR まで（推奨）' } },
        text: 'answered',
      }))

      // バックグラウンドタスクの通知（英語）は言語の判定に使わない
      await typed($, 'この要望を ship して')
      await $.prompt.submit({ text: 'Background task finished', wait: false, origin: { kind: 'task-notification' } })
      await skill($, 'ship-session:ship-session')
      await $.tool.call({
        tool: 'AskUserQuestion',
        questions: [
          {
            question: 'どこまで進めますか？',
            header: '到達点',
            multiSelect: false,
            options: [
              { label: 'PR まで（推奨）', description: 'draft PR を作って止める' },
              { label: 'マージまで', description: 'マージして片付ける' },
            ],
          },
        ],
      })
      const text = await bandText($, surface)
      expect(text).toContain('PR まで（推奨）')
      expect(text).toContain('✔ 到達点')
      expect(text).toContain('▶ Issue')
    })

    test(`${surface}: header をキーにした回答からも到達点を取る`, async ($, on) => {
      answerSkills(on)
      answerEngineBand(on)
      on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => ({
        result: { questions: e.questions, answers: { Goal: 'Up to merge' } },
        text: 'answered',
      }))

      await skill($, 'ship-session:ship-session')
      await $.tool.call({
        tool: 'AskUserQuestion',
        questions: [
          {
            question: 'How far should this go?',
            header: 'Goal',
            multiSelect: false,
            options: [
              { label: 'Up to PR', description: 'stop at a draft PR' },
              { label: 'Up to merge', description: 'merge and clean up' },
            ],
          },
        ],
      })
      expect(await bandText($, surface)).toContain('Up to merge')
    })

    test(`${surface}: ship-session を起動し直すと表示を最初からにする`, async ($, on) => {
      answerBash(on, {
        [`${GOAL_SCRIPT} record`]: { stdout: 'Recorded the goal: Issue only' },
        'gh issue create': { stdout: 'https://github.com/acme/app/issues/7' },
      })
      answerSkills(on)
      answerEngineBand(on)

      await skill($, 'ship-session:ship-session')
      await bash($, `${GOAL_SCRIPT} record "Issue only"`)
      await bash($, 'gh issue create --title x --body y')
      await skill($, 'ship-session:ship-session')
      const text = await bandText($, surface)
      expect(text).not.toContain('#7')
      expect(text).not.toContain('Issue only')
      expect(text).toContain('▶ Goal')
    })
  }
})
