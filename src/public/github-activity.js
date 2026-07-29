const activitySelector = ".github-activity";
const openClass = "is-open";
const triggerSelector = "[data-github-activity-trigger]";

function closeGitHubActivity(activity) {
  activity.classList.remove(openClass);
  activity
    .querySelector(triggerSelector)
    ?.setAttribute("aria-expanded", "false");
}

export function attachGitHubActivityListener(root = document) {
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest(triggerSelector);

    if (trigger) {
      const activity = trigger.closest(activitySelector);
      const isOpen = activity?.classList.toggle(openClass) ?? false;

      trigger.setAttribute("aria-expanded", String(isOpen));
      return;
    }

    root
      .querySelectorAll(`${activitySelector}.${openClass}`)
      .forEach((activity) => {
        if (!activity.contains(event.target)) {
          closeGitHubActivity(activity);
        }
      });
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const activity = root.querySelector(`${activitySelector}.${openClass}`);
      const trigger = activity?.querySelector(triggerSelector);

      if (activity) {
        closeGitHubActivity(activity);
        trigger?.focus();
      }
    }
  });

  root.addEventListener("focusout", (event) => {
    const activity = event.target.closest(activitySelector);

    if (activity && !activity.contains(event.relatedTarget)) {
      closeGitHubActivity(activity);
    }
  });
}

attachGitHubActivityListener();
