const demoVideo = document.getElementById("demo-video");
const demoButtons = [...document.querySelectorAll(".app-btn")];
if (demoVideo && demoButtons.length) {
  const demos = [
    {id: "forms", src: "demos/forms.mp4", label: "AuraSolve on Google Forms"},
    {id: "canvas", src: "demos/canvas.mp4", label: "AuraSolve on Canvas"},
    {id: "pearson", src: "demos/pearson.mp4", label: "AuraSolve on Pearson"},
  ];
  let index = 0;
  const show = next => {
    index = (next + demos.length) % demos.length;
    const demo = demos[index];
    demoButtons.forEach(button => {
      const on = button.dataset.demo === demo.id;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-selected", String(on));
    });
    demoVideo.setAttribute("aria-label", demo.label);
    if (demoVideo.getAttribute("src") !== demo.src) {
      demoVideo.src = demo.src;
      demoVideo.load();
    }
    demoVideo.play().catch(() => {});
  };
  demoButtons.forEach(button => button.addEventListener("click", () => {
    const next = demos.findIndex(demo => demo.id === button.dataset.demo);
    if (next < 0) return;
    demos[next].missing = false;
    show(next);
  }));
  const nextPlayable = from => {
    for (let hop = 1; hop <= demos.length; hop++) {
      const candidate = (from + hop) % demos.length;
      if (!demos[candidate].missing) return candidate;
    }
    return from;
  };
  demoVideo.addEventListener("ended", () => show(nextPlayable(index)));
  demoVideo.addEventListener("error", () => {
    if (demoVideo.error?.code === 1) return;
    demos[index].missing = true;
    const next = nextPlayable(index);
    if (next !== index) show(next);
  });
  show(0);
}

const logoTrack = document.querySelector(".logo-track");
if (logoTrack) {
  logoTrack.append(...[...logoTrack.children].map(node => {
    const copy = node.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.querySelector("img")?.setAttribute("alt", "");
    return copy;
  }));
}
