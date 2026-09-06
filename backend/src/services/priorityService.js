const { PRIORITY, CONTENT_TYPE } = require('../utils/constants');

/**
 * Given the current set of active alerts and tasks plus the standing playlist,
 * resolve which single piece of content should currently be displayed.
 *
 * Priority order (highest first):
 *   Emergency Alert > High Task > Medium Task > Low Task > Normal Playlist
 */
function resolveActiveContent({ alerts = [], tasks = [], playlist = null, now = new Date() }) {
  const activeAlerts = alerts.filter((a) => a.active && new Date(a.expires) > now);
  if (activeAlerts.length > 0) {
    const topAlert = activeAlerts.sort((a, b) => b.priority - a.priority)[0];
    return { type: CONTENT_TYPE.ALERT, content: topAlert };
  }

  const activeTasks = tasks.filter((t) => {
    const start = new Date(t.schedule.start);
    const end = new Date(t.schedule.end);
    return start <= now && end >= now;
  });

  if (activeTasks.length > 0) {
    const topTask = activeTasks.sort((a, b) => b.priority - a.priority)[0];
    return { type: CONTENT_TYPE.TASK, content: topTask };
  }

  if (playlist) {
    return { type: CONTENT_TYPE.PLAYLIST, content: playlist };
  }

  return { type: null, content: null };
}

function sortByPriorityDesc(items) {
  return [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

module.exports = { resolveActiveContent, sortByPriorityDesc, PRIORITY };
