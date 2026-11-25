export const spreads = [
  {
    label: "The landing and the tea shop",
    left: {
      folio: "01 / THE LANDING · 06:10",
      lines: [
        "# Before the first ferry",
        "Rain had softened the planks overnight. A breakfast cart rattled past, trailing steam from a bamboo basket. By the time it reached the road, the steam was gone.",
        "The ferryman sat on a bollard, eating a sesame bun. I asked when he would leave. He broke the bun in half and nodded toward the houses across the river.",
        "> Wait for the first light in a window.",
        "I sat in the shelter and balanced my notebook on one knee. Water dripping from the roof gave me something to count.",
      ],
      prefix: "Across the river, it was",
      last: "still dark",
    },
    right: {
      folio: "02 / THE TEA SHOP · 08:25",
      lines: [
        "# A cup by the window",
        "Ten minutes after I got off the boat, it started raining again. The woman opening the tea shop wiped the window with yesterday's paper and waved me toward the dry end of the table.",
        "## On the table",
        "- A white cup with a chip in the rim",
        "- Two grains of osmanthus on the sill",
        "- A receipt with “Careful in the rain” written on it",
        "She turned the spout away from me before pouring herself a cup. The brass bell over the door rang twice. Neither of us stood up.",
      ],
      prefix: "For the first time that morning, I could",
      last: "slow down",
    },
  },
  {
    label: "The bridge and the passing boat",
    left: {
      folio: "03 / THREE-ARCH BRIDGE · 10:40",
      lines: [
        "# The rain stopped here",
        "A man carrying two fish climbed the bridge. Water dripped from his bag all the way to the middle. Only after he crossed did the reflection join up again.",
        "> Keep room for the water. The reflection is darker than the roof.",
        "![A sketch from the riverbank](canal)",
        "I stopped at the waterline. The toes of my shoes were wet, but the paper was still dry.",
      ],
      sketch: 1,
      prefix: "On the bridge, even the cracks",
      last: "began to shine",
    },
    right: {
      folio: "04 / DOWNRIVER · 11:30",
      lines: [
        "# Listening to a boat",
        "The boatman was close enough to speak to, but he said nothing. He lifted his oar to clear the bridge and let the boat drift the rest of the way.",
        "## What carried over the water",
        "- A click as the oar touched the gunwale",
        "- Three splashes, the last one barely there",
        "- A set of footsteps that stopped on the bridge",
        "I kept looking at my notebook and tried to tell how far away the boat was. By the end, I couldn't separate the sound of water from the wind on the bank.",
      ],
      prefix: "The boat was out of sight. I was",
      last: "still listening",
    },
  },
  {
    label: "An evening revision and tomorrow's route",
    left: {
      folio: "05 / THE INN · 17:45",
      lines: [
        "# Leave a door in the sentence",
        "At the inn I read the day's notebook back. I'd called the river quiet three times. By the third, I'd forgotten what quiet had sounded like.",
        "## Crossed out in the first draft",
        "- [x] Life here moves at a slower pace.",
        "- [x] Old houses tell their stories.",
        "- [x] Everything looked like a painting.",
        "I put the door back in. Its hinge squeaked once when someone came in. Nobody at the table looked up. They knew who it was by the sound.",
      ],
      prefix: "Three lines gone, and I kept",
      last: "one good detail",
    },
    right: {
      folio: "06 / THE RETURN LANDING · 19:20",
      lines: [
        "# The other bank tomorrow",
        "The ticket window was shut when I got back. I asked the ferryman what lay beyond the road on the other bank. He said there was an old mulberry grove, probably in bud by now.",
        "## Before leaving",
        "- [x] Save today's notes as river-notes.md",
        "- [ ] Ask which ferry leaves first",
        "- [ ] Walk along the river to the mulberry grove",
        "> On the way back, stop under the bridge and listen.",
        "He pointed out the landing and tucked his hands back into his sleeves.",
      ],
      prefix: "After breakfast, I’ll take the first ferry and",
      last: "try again",
    },
  },
];

const serif = 'Georgia, "Times New Roman", serif';
const sans = "system-ui, sans-serif";
const bodyFont = "30px " + serif;
const ink = "#545649";
const margin = 91;
const textWidth = 878;

function text(ctx, value, x, y, font, color) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(value, x, y);
}

function linesFor(ctx, value, font, width) {
  ctx.font = font;
  const lines = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line ? line + " " + word : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(ctx, value, x, y, font, color, width, leading) {
  const lines = linesFor(ctx, value, font, width);
  lines.forEach((line, index) =>
    text(ctx, line, x, y + index * leading, font, color),
  );
  return y + lines.length * leading;
}

function rule(ctx, y, color = "#99948170") {
  ctx.fillStyle = color;
  ctx.fillRect(margin, y, textWidth, 1.15);
}

function renderBlocks(ctx, lines, artwork) {
  let y = 199;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      y =
        paragraph(
          ctx,
          line.slice(2),
          margin,
          y,
          "600 55px " + serif,
          "#343b32",
          textWidth,
          58,
        ) + 20;
    } else if (line.startsWith("## ")) {
      y = paragraph(
        ctx,
        line.slice(3),
        margin,
        y + 6,
        "600 33px " + serif,
        "#496052",
        textWidth,
        42,
      );
    } else if (line.startsWith("> ")) {
      const font = "italic 28px " + serif;
      const lines = linesFor(ctx, line.slice(2), font, textWidth - 52);
      const height = lines.length * 34 + 19;
      ctx.beginPath();
      ctx.roundRect(margin, y - 27, textWidth, height, 8);
      ctx.fillStyle = "#777d6314";
      ctx.fill();
      ctx.fillStyle = "#7d8976";
      ctx.fillRect(margin, y - 27, 3.5, height);
      y =
        paragraph(
          ctx,
          line.slice(2),
          margin + 23,
          y + 3,
          font,
          "#5c6452",
          textWidth - 52,
          34,
        ) + 18;
    } else if (line.startsWith("- ")) {
      const task = line.startsWith("- [");
      if (task) {
        ctx.strokeStyle = "#77856e";
        ctx.lineWidth = 2;
        ctx.strokeRect(margin + 6, y - 20, 20, 20);
        if (line[3] === "x") {
          ctx.beginPath();
          ctx.moveTo(margin + 10, y - 10);
          ctx.lineTo(margin + 15, y - 4);
          ctx.lineTo(margin + 23, y - 16);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "#7c896f";
        ctx.beginPath();
        ctx.arc(margin + 12, y - 10, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      y = paragraph(
        ctx,
        task ? line.slice(6) : line.slice(2),
        margin + 42,
        y,
        bodyFont,
        ink,
        textWidth - 42,
        38,
      );
    } else if (line.startsWith("![") && artwork) {
      ctx.save();
      ctx.globalAlpha = 0.83;
      ctx.drawImage(artwork, 0, 325, 2120, 484, margin, y - 17, textWidth, 192);
      ctx.restore();
      y += 198;
    } else {
      y = paragraph(ctx, line, margin, y, bodyFont, ink, textWidth, 40) + 13;
    }
  }
  return y;
}

export function renderJournal(ctx, page, index, right, artwork) {
  text(ctx, page.folio, margin, 104, "500 19px " + sans, "#71745f");
  text(ctx, "PAIRDOWN", 850, 104, "500 18px Georgia", "#737662");
  rule(ctx, 128);
  renderBlocks(ctx, page.lines, artwork);
  const baseline = 801;
  text(ctx, page.prefix, margin, baseline, bodyFont, ink);
  const position = {
    text: page.last,
    x: margin + ctx.measureText(page.prefix).width + 8,
    y: baseline,
    size: 34,
  };
  rule(ctx, 857, "#99948157");
  text(
    ctx,
    String(index * 2 + (right ? 2 : 1)).padStart(2, "0"),
    right ? 935 : margin,
    895,
    "19px Georgia",
    "#77705c",
  );
  return position;
}

function element(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}

function articleFor(page) {
  const article = document.createElement("article");
  article.setAttribute("aria-label", page.folio);
  let list;
  for (const line of page.lines) {
    if (line.startsWith("- ")) {
      if (!list) {
        list = document.createElement("ul");
        article.append(list);
      }
      const task = line.startsWith("- [");
      const value = task
        ? (line[3] === "x" ? "Done: " : "To do: ") + line.slice(6)
        : line.slice(2);
      list.append(element("li", value));
      continue;
    }
    list = undefined;
    if (line.startsWith("# ")) article.append(element("h2", line.slice(2)));
    else if (line.startsWith("## "))
      article.append(element("h3", line.slice(3)));
    else if (line.startsWith("> "))
      article.append(element("blockquote", line.slice(2)));
    else if (line.startsWith("!["))
      article.append(element("p", line.slice(2, line.indexOf("]"))));
    else article.append(element("p", line));
  }
  article.append(element("p", page.prefix + " " + page.last + "."));
  return article;
}

export function renderTranscript(container, visibleSpreads) {
  const articles = visibleSpreads.flatMap((spread) => [
    articleFor(spread.left),
    articleFor(spread.right),
  ]);
  container.replaceChildren(...articles);
}
