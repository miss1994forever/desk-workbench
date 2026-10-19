/** These are editable product choices about useful deliverables, not difficulty
 * scores or psychological/academic verification. Evidence remains owner report. */
export type MilestoneDefinition = { id: string; project_key: string; title: string; criterion: string };
export type MilestoneRecord = { key: string; milestone_id: string; project_key: string; package_id: string; title: string; criterion: string; evidence: string; completed_at: string; completed_by: string; basis: "owner_report" | "agent_report"; event_id: string };
export type MilestonePackage = { id: string; content: { kind?: string; project_key?: string } };
const CATALOG: Record<string, readonly { id: string; title: string; criterion: string }[]> = {
  "sample-research": [
    { id: "task-evidence-map", title: "任务—证据卡成稿", criterion: "留下可审阅的任务—证据卡：输入、期望改变与应保留部分、能支持判断的例子，以及现有证据不能推出的结论。" },
    { id: "transfer-comparison", title: "留下迁移对照结果", criterion: "留下真实样例或可复现对照，说明输出相对输入或基线改变了什么；没有改善也记录具体观察与条件。" },
    { id: "diagnosis-next-experiment", title: "诊断支持下一次实验", criterion: "用已有结果定位一个具体失败模式或证据缺口，留下诊断依据和能区分解释的下一次实验设计。" },
  ],
  research_topic: [
    { id: "research-scenario", title: "真实科研场景卡完成", criterion: "留下你认可的场景卡：研究者正在做的事、卡住的具体判断、跨领域连接将改变的步骤与成功标准。" },
    { id: "literature-position", title: "文献判断支持选题", criterion: "留下带论文出处的比较，讲清已有方法解决了什么、仍缺什么，以及哪些只是你待验证的推测。" },
    { id: "topic-proposal", title: "选题与工具初想可讨论", criterion: "形成可交给导师讨论的研究问题、工具交互初想及验证方式；保留你的取舍和尚未解决的疑问。" },
  ],
  paper_project: [
    { id: "claim-evidence-boundary", title: "论文主张与证据对齐", criterion: "留下可审阅的贡献—证据对应稿，标出结果支持的范围、不能支持的强结论和最强质疑。" },
    { id: "diagnostic-evidence", title: "关键质疑有了证据", criterion: "留下针对关键质疑的分析、实验或失败案例，并注明数据、条件与结论边界；负结果同样可以。" },
    { id: "manuscript-revision", title: "形成可审阅的论文修订", criterion: "留下实际修订的论文段落或图表，说明改动解决的论证问题、对应证据及仍需补齐之处。" },
  ],
  demo_project: [
    { id: "demo-core-loop", title: "核心链路演示跑通", criterion: "留下真实运行的核心链路演示或录屏，说明使用场景、成功点和实际阻碍；纯脚本或未实测构想不算跑通。" },
    { id: "blocker-diagnosis", title: "关键阻碍有了诊断", criterion: "留下一个实际阻碍的复现步骤、日志或对照证据，并说明排除或支持了哪种解释；不要求已经修好。" },
    { id: "demo-improvement", title: "演示有可见的改进", criterion: "留下改动后的可运行版本或前后演示，指出用户能感知的变化与仍存在的限制。" },
  ],
  "computer-animation": [
    { id: "vo-rvo-explanation", title: "VO/RVO解释与例图完成", criterion: "留下能独立使用的解释或例图：相对速度、碰撞判断、振荡原因与责任分担，并标出课件依据和未理解处。" },
    { id: "vo-rvo-test", title: "用实例检验并修正解释", criterion: "用手算、代码或具体轨迹对照检验解释，留下结果及据此保留或修正的判断；反例与失败记录同样有效。" },
  ],
  blockchain: [
    { id: "hash-implementation", title: "Hash实验实现跑通", criterion: "留下可复现的实现与真实运行结果，讲清输入、成功条件和验证方式；只是读清要求或确认提交状态不算。" },
    { id: "hash-measurement", title: "实验测量支持结论", criterion: "留下测量条件、实际记录和比较结论，说明随机性、误差或异常如何影响解释。" },
    { id: "hash-deliverable", title: "作业交付材料完成", criterion: "留下可交付的代码与报告或已有提交记录，指出结果证据的位置及仍需核对的事项。" },
  ],
  "collaboration-pm": [
    { id: "lssp-discussion-draft", title: "上线答复形成可讨论稿", criterion: "留下能用于会议讨论的实际答复，覆盖已知前提、供应商步骤、风险和待核问题；仅确认已有稿件位置不算。" },
    { id: "lssp-risk-revision", title: "核查结果进入答复", criterion: "针对关键步骤或风险留下核查依据，并实际修订答复；无法确认时明确缺口、原因与待问对象。" },
    { id: "lssp-handoff", title: "答复完成讨论或交接", criterion: "留下已讨论或已交接版本及真实反馈、决定或下一责任人，清楚区分已确认与仍待处理事项。" },
  ],
  "collaboration-guide": [
    { id: "guide-path-check", title: "组织与TA路径实际核查", criterion: "留下从起点到结果的真实路径核查记录，标出权限、阻碍或缺失步骤；仅找到旧指南或录屏不算。" },
    { id: "guide-revision", title: "指南修订可供审阅", criterion: "基于核查实际补齐或修正指南，留下版本位置和读者现在能完成的步骤，注明仍未验证的部分。" },
    { id: "guide-handoff", title: "指南版本完成交接", criterion: "留下真实送审、交接或采用的版本及反馈/责任边界，说明后续由谁处理仍存问题。" },
  ],
  "iot-resnet": [
    { id: "baseline-reproduced", title: "ResNet基线真实跑通", criterion: "留下统一模型与数据条件下的真实基线运行产物、测量结果或日志；核对做到哪里、已有提交状态不算。" },
    { id: "compression-comparison", title: "压缩对照有了结果", criterion: "留下剪枝/微调或量化前后的实际模型与对照记录，说明准确率、大小或相关指标的变化和实验条件。" },
    { id: "board-measurement", title: "板端部署与测量完成", criterion: "留下香橙派实际部署和统一程序测量记录，注明后端、配置与结果；失败也可留下足以定位阻碍的诊断证据。" },
    { id: "experiment-report", title: "实验报告形成可交付版", criterion: "留下基于本人真实记录的报告与所需交付物，讲清对照结论、证据位置和限制；不捏造测试结果或提交回执。" },
  ],
};

export function milestonesForPackage(pkg: MilestonePackage): MilestoneDefinition[] {
  const project_key = pkg.content.project_key;
  if (pkg.content.kind !== "guided_work" || typeof project_key !== "string" || !Object.hasOwn(CATALOG, project_key)) return [];
  return CATALOG[project_key].map((milestone) => ({ ...milestone, project_key }));
}
export function milestoneKey(projectKey: string, milestoneId: string): string { return `${projectKey}:${milestoneId}`; }
export function milestoneStatus(cinema: unknown, pkg: MilestonePackage, milestoneId: string): MilestoneRecord | null {
  if (!milestonesForPackage(pkg).some((milestone) => milestone.id === milestoneId)) return null;
  const value = cinema as { milestones?: unknown } | null;
  if (!value || !Array.isArray(value.milestones)) return null;
  const key = milestoneKey(pkg.content.project_key!, milestoneId);
  return value.milestones.find((record) => record && typeof record === "object" && record.key === key) ?? null;
}
