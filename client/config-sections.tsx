import React from "react";
import { View } from "react-native";
import { at, ChoiceSetting, type Form, ListSetting, NumberSetting, supports, TextSetting, ToggleSetting } from "./config-form";
import { Heading, Notice } from "./ui";

export const PRESETS = ["default", "ryan", "technical", "ste", "minimal", "all", "git", "statistical"];
const MODES = ["confirm", "ask", "deny"];
const MODE_HINT = "confirm denies once and keeps an identical retry. ask uses the Claude permission prompt or an omp confirm dialog. deny blocks until the retry limit.";
const Group = ({ children }: { children: React.ReactNode }) => <View style={{ gap: 4, minWidth: 0 }}>{children}</View>;

export function LimitsSection({ form }: { form: Form }) {
  return <Group>
    <Heading theme={form.theme} title="Limits" description="Line and sentence limits for the core checks." />
    <NumberSetting form={form} path="maxCommentLines" label="Comment lines" hint="Longest contiguous comment run in new text." />
    <NumberSetting form={form} path="maxFileLines" label="New file lines" hint="Longest new file." />
    <NumberSetting form={form} path="maxPrBodyParagraphs" label="PR paragraphs" hint="Prose paragraphs in a gh pr or issue body." />
    <NumberSetting form={form} path="maxPrBodySentences" label="Sentences per paragraph" hint="Sentences in one gh body paragraph." />
    <NumberSetting form={form} path="maxRetries" label="Retries" min={0} hint="Denials on one target before the hook allows it with a notice." />
  </Group>;
}

export function ChecksSection({ form }: { form: Form }) {
  const stopOff = (at(form.value, "stopHook") ?? at(form.effective, "stopHook")) === false;
  return <Group>
    <Heading theme={form.theme} title="Core checks" />
    <ToggleSetting form={form} path="checks.comments" label="Comment length" />
    <ToggleSetting form={form} path="checks.fileSize" label="File length" />
    <ToggleSetting form={form} path="checks.prBody" label="PR body length" />
    <ToggleSetting form={form} path="softFail" label="Soft fail" hint="Turns every deny, ask, and block into an allow with a notice." />
    {supports(form, "scan.codeFiles") && <>
      <Heading theme={form.theme} title="Scanned text" description="Places the style checks read beyond file writes and edits. Each switch stops the style checks there only." />
      <ToggleSetting form={form} path="scan.codeFiles" label="Whole code files" hint="Runs code-scope packs and dictionary entries over whole code files, string literals included." />
      <ToggleSetting form={form} path="scan.notebooks" label="Notebook cells" hint="Cells that NotebookEdit writes." />
      <ToggleSetting form={form} path="scan.heredocWrites" label="Heredoc file writes" hint="Files that cat or tee writes from a heredoc, before the command runs." />
      <ToggleSetting form={form} path="scan.shellWrites" label="Files shell commands change" hint="Lines a shell command added to files in a git work tree, after it runs." />
      <ToggleSetting form={form} path="scan.mcp" label="MCP tool posts" hint="Text and files that MCP tools post or write." />
      <ToggleSetting form={form} path="scan.plans" label="Plans" hint="The plan that ExitPlanMode shows for approval." />
      <ToggleSetting form={form} path="scan.tasks" label="Tasks" hint="TaskCreate and TaskUpdate text." />
      <ToggleSetting form={form} path="scan.questions" label="Questions to you" hint="AskUserQuestion questions and options." />
    </>}
    <Heading theme={form.theme} title="Replies" description="Checks on the final reply and on subagent reports." />
    <ToggleSetting form={form} path="stopHook" label="Check final replies" />
    <ToggleSetting form={form} path="subagentStop.enabled" label="Check subagent replies" hint="Also covers SubagentHandback reports in Claude Code auto mode. omp has no subagent stop event, so it does not check them." />
    {stopOff && supports(form, "subagentStop.enabled") && <Notice theme={form.theme} tone="warning">Final reply checks are off, so subagent replies are not checked.</Notice>}
    <ListSetting form={form} path="subagentStop.exemptAgentTypes" label="Exempt agent types" merge="replace" placeholder="Explore" />
    {supports(form, "context.enabled") && <>
      <Heading theme={form.theme} title="Session rules" description="Sends the resolved limits and escape hatches to the agent." />
      <ToggleSetting form={form} path="context.enabled" label="Send rules on start" hint="At startup, resume, clear, compaction, and subagent start." />
      <ToggleSetting form={form} path="context.perTurn" label="Send rules on every prompt" hint="Adds the rules on UserPromptSubmit." />
    </>}
    {supports(form, "testFilter.codexPostToolUse") && <>
      <Heading theme={form.theme} title="Test output" />
      <ToggleSetting form={form} path="testFilter.codexPostToolUse" label="Codex: filter completed test output"
        hint="Filters results after the run instead of rewriting the command. Requires a Codex version that reports the exit status." />
    </>}
  </Group>;
}

export function StyleSection({ form }: { form: Form }) {
  const preset = String(at(form.value, "features.aiWriting.preset") ?? at(form.effective, "features.aiWriting.preset") ?? "default");
  return <Group>
    <Heading theme={form.theme} title="Dash check" description="Flags em dashes and, optionally, en dashes and double hyphens." />
    <ToggleSetting form={form} path="features.emDash.enabled" label="Dash check" />
    <ToggleSetting form={form} path="features.emDash.enDash" label="Include en dashes" />
    <ToggleSetting form={form} path="features.emDash.doubleHyphen" label="Include double hyphens" />
    <ToggleSetting form={form} path="features.emDash.replies" label="Check dashes in replies" />
    <ChoiceSetting form={form} path="features.emDash.mode" label="Dash mode" values={MODES} hint={MODE_HINT} />
    <Heading theme={form.theme} title="AI writing" description="Pattern packs selected by a preset." />
    <ToggleSetting form={form} path="features.aiWriting.enabled" label="AI writing check" />
    <ToggleSetting form={form} path="features.aiWriting.replies" label="Check AI writing in replies" />
    <ChoiceSetting form={form} path="features.aiWriting.preset" label="Writing preset" values={PRESETS.includes(preset) ? PRESETS : [...PRESETS, preset]} />
    <ChoiceSetting form={form} path="features.aiWriting.mode" label="Writing mode" values={MODES} />
    <ListSetting form={form} path="features.aiWriting.allow" label="Allowed words" merge="union" hint="Words or phrases the AI writing check never flags." placeholder="load-bearing" />
    <ListSetting form={form} path="features.aiWriting.enablePatterns" label="Turn on patterns" merge="layer" hint="Category id, pack id, or tag:<tag>." placeholder="tag:filler" />
    <ListSetting form={form} path="features.aiWriting.disablePatterns" label="Turn off patterns" merge="layer" hint="Category id, pack id, or tag:<tag>." />
  </Group>;
}

export function ExceptionsSection({ form }: { form: Form }) {
  return <Group>
    <Heading theme={form.theme} title="Ignored paths" />
    <ListSetting form={form} path="ignoreGlobs" label="Skip every check" merge="replace" placeholder="**/generated/**" />
    <ListSetting form={form} path="styleIgnoreGlobs" label="Skip style checks" merge="union" hint="Comment and file length checks still apply." placeholder="**/docs/legacy/**" />
    <Heading theme={form.theme} title="Allowed text" description="Drops one finding when its text or line matches." />
    <ListSetting form={form} path="allowList.phrases" label="Allowed phrases" merge="union" hint="Case-insensitive." />
    <ListSetting form={form} path="allowList.patterns" label="Allowed patterns" merge="union" hint="Regular expressions, compiled with the i flag." placeholder="^Fixes #\d+" />
    <Heading theme={form.theme} title="Bypass" description="Skips every check on a tool call or reply that matches." />
    <ListSetting form={form} path="bypass.phrases" label="Bypass phrases" merge="union" placeholder="concise-bypass" />
    <ListSetting form={form} path="bypass.patterns" label="Bypass patterns" merge="union" placeholder="^WIP:" />
  </Group>;
}

export function LoggingSection({ form }: { form: Form }) {
  return <Group>
    <Heading theme={form.theme} title="Activity" />
    <ToggleSetting form={form} path="monitor.persist" label="Persist activity" hint="Saves each hook request and response for this view and concise-web." />
    <Heading theme={form.theme} title="Hook log" description="One record per hook call." />
    <ToggleSetting form={form} path="log.enabled" label="Write the hook log" />
    <TextSetting form={form} path="log.path" label="Log file" placeholder="~/.cache/concise/concise.log" />
    <ChoiceSetting form={form} path="log.format" label="Format" values={["json", "plaintext"]} />
    <ChoiceSetting form={form} path="log.rotate" label="Rotation" values={["size", "daily", "both", "none"]} />
    <TextSetting form={form} path="log.maxSize" label="Rotate at size" hint="A size such as 5m or 512k." />
    <NumberSetting form={form} path="log.maxFiles" label="Rotated files kept" />
  </Group>;
}
