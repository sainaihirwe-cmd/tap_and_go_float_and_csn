function finishAgentShift(agent, endedAt = new Date()) {
  if (!agent.shiftStartedAt) return;
  agent.lastShiftSeconds = Math.max(0, Math.floor((endedAt.getTime() - new Date(agent.shiftStartedAt).getTime()) / 1000));
  agent.shiftSeconds = (Number(agent.shiftSeconds) || 0) + agent.lastShiftSeconds;
  agent.shiftStartedAt = null;
}

function finishDistributorShift(distributor, endedAt = new Date()) {
  if (!distributor.dutyStartedAt) return;
  distributor.lastDutySeconds = Math.max(0, Math.floor((endedAt.getTime() - new Date(distributor.dutyStartedAt).getTime()) / 1000));
  distributor.dutySeconds = (Number(distributor.dutySeconds) || 0) + distributor.lastDutySeconds;
}

module.exports = { finishAgentShift, finishDistributorShift };
