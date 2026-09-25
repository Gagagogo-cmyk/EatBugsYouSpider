# -*- coding: utf-8 -*-
path = "src/gui/edit_agent.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

anchor_resolve = (
    '  function resolveSafe(relPath) {\n'
    '    if (typeof relPath !== "string" || !relPath.trim()) {\n'
    '      throw new Error("path is required");\n'
    '    }\n'
    '    const full = path.resolve(repoRoot, relPath);\n'
    '    if (full !== repoRoot && !full.startsWith(repoRoot + path.sep)) {\n'
    '      throw new Error("path escapes the repo root — refusing");\n'
    '    }\n'
    '    const rel = path.relative(repoRoot, full) || ".";\n'
    '    const parts = rel.split(path.sep);\n'
    '    for (const p of parts) {\n'
    '      if (EXCLUDED_DIRS.has(p)) {\n'
    '        throw new Error(`path passes through an excluded directory ("${p}") — refusing`);\n'
    '      }\n'
    '    }\n'
    '    if (EXCLUDED_FILE_RE.test(path.basename(rel))) {\n'
    '      throw new Error("refusing to touch a .bak file directly — use undo_change instead");\n'
    '    }\n'
    '    return { full, rel };\n'
    '  }\n'
)
n = content.count(anchor_resolve)
assert n == 1, "anchor_resolve count = %d" % n

lines = []
lines.append('  // BRANCHES -- user: "the system needs to tell the user its gonna')
lines.append('  // create a branch of the seed... that new branch can be merged with')
lines.append('  // the original one." The three files EDIT INTERFACE ever plausibly')
lines.append('  // touches for a panel visual/behavior request. The server (gui_hub_')
lines.append('  // bridge.js, edit_agent.js itself) is NOT branched -- branching a')
lines.append('  // running server process is a much bigger undertaking (separate port,')
lines.append('  // separate process) that is out of scope here; only the served')
lines.append('  // frontend files are.')
lines.append('  const BRANCHABLE_RELPATHS = ["src/gui/panel.html", "src/gui/ebys-live.js", "src/gui/ebys-link.js"];')
lines.append('  let activeBranchDir = null;')
lines.append('  let activeBranchName = null;')
lines.append('')
lines.append('  // Every tool that touches one of the branchable files goes through')
lines.append('  // this (resolveSafe for single-file tools, the search_files walk for')
lines.append('  // the multi-file one, both below) so Cricket always reads/writes the')
lines.append('  // ACTIVE branch copy once one exists, transparently -- it still just')
lines.append('  // says path:"src/gui/panel.html" in every tool call, unchanged.')
lines.append('  function branchAwareFull(relFromRepo, fallbackFull) {')
lines.append('    if (activeBranchDir && BRANCHABLE_RELPATHS.indexOf(relFromRepo) !== -1) {')
lines.append('      return path.join(activeBranchDir, path.basename(relFromRepo));')
lines.append('    }')
lines.append('    return fallbackFull;')
lines.append('  }')
lines.append('')
lines.append('  function getCurrentBranch() {')
lines.append('    return activeBranchName;')
lines.append('  }')
lines.append('')
lines.append('  // Deterministic (no Ollama involved) -- gui_hub_bridge.js calls this')
lines.append('  // directly once the user has answered "what do you want to name this')
lines.append('  // branch". A full snapshot copy, same reasoning apply_patch/undo_change')
lines.append('  // already use .bak file copies for: simple, obviously-correct, no')
lines.append('  // diffing/merging logic to get subtly wrong.')
lines.append('  function createBranch(name) {')
lines.append('    const slug = slugify(name);')
lines.append('    const dir = uniquePath(path.join(repoRoot, "src/gui/branches", slug));')
lines.append('    fs.mkdirSync(dir, { recursive: true });')
lines.append('    for (const rel of BRANCHABLE_RELPATHS) {')
lines.append('      fs.copyFileSync(path.join(repoRoot, rel), path.join(dir, path.basename(rel)));')
lines.append('    }')
lines.append('    activeBranchDir = dir;')
lines.append('    activeBranchName = path.basename(dir);')
lines.append('    return activeBranchName;')
lines.append('  }')
lines.append('')
lines.append('  // Deterministic straight-overwrite merge (user picked this over a')
lines.append('  // review step): the branch files become the seed files. The seed own')
lines.append('  // prior content is never actually lost -- backed up first via the')
lines.append('  // same .bak convention as every other write in this file, read into')
lines.append('  // memory before writing anything, same race-safety pattern as')
lines.append('  // undo_change above.')
lines.append('  function mergeBranch() {')
lines.append('    if (!activeBranchDir) throw new Error("no active branch to merge");')
lines.append('    const mergedFiles = [];')
lines.append('    for (const rel of BRANCHABLE_RELPATHS) {')
lines.append('      const seedFull = path.join(repoRoot, rel);')
lines.append('      const branchFull = path.join(activeBranchDir, path.basename(rel));')
lines.append('      if (!fs.existsSync(branchFull)) continue;')
lines.append('      const branchContent = fs.readFileSync(branchFull);')
lines.append('      if (fs.existsSync(seedFull)) {')
lines.append('        const bak = uniquePath(`${seedFull}.bak-${timestamp()}-pre-merge-${activeBranchName}`);')
lines.append('        fs.writeFileSync(bak, fs.readFileSync(seedFull));')
lines.append('      }')
lines.append('      fs.writeFileSync(seedFull, branchContent);')
lines.append('      mergedFiles.push(rel);')
lines.append('    }')
lines.append('    const merged = activeBranchName;')
lines.append('    activeBranchDir = null;')
lines.append('    activeBranchName = null;')
lines.append('    return { merged, mergedFiles };')
lines.append('  }')
lines.append('')
lines.append('  function resolveSafe(relPath) {')
lines.append('    if (typeof relPath !== "string" || !relPath.trim()) {')
lines.append('      throw new Error("path is required");')
lines.append('    }')
lines.append('    const full = path.resolve(repoRoot, relPath);')
lines.append('    if (full !== repoRoot && !full.startsWith(repoRoot + path.sep)) {')
lines.append('      throw new Error("path escapes the repo root — refusing");')
lines.append('    }')
lines.append('    const rel = path.relative(repoRoot, full) || ".";')
lines.append('    const parts = rel.split(path.sep);')
lines.append('    for (const p of parts) {')
lines.append('      if (EXCLUDED_DIRS.has(p)) {')
lines.append('        throw new Error(`path passes through an excluded directory ("${p}") — refusing`);')
lines.append('      }')
lines.append('    }')
lines.append('    if (EXCLUDED_FILE_RE.test(path.basename(rel))) {')
lines.append('      throw new Error("refusing to touch a .bak file directly — use undo_change instead");')
lines.append('    }')
lines.append('    return { full: branchAwareFull(rel, full), rel };')
lines.append('  }')

replacement_resolve = "\n".join(lines) + "\n"
content = content.replace(anchor_resolve, replacement_resolve, 1)

anchor_search = (
    '          const full = path.join(dir, ent.name);\n'
    '          let text;\n'
    '          try {\n'
    '            text = fs.readFileSync(full, "utf8");\n'
    '          } catch (e) {\n'
    '            continue; // unreadable / not text\n'
    '          }\n'
    '          const lines = text.split("\\n");\n'
    '          let hitsThisFile = 0;\n'
    '          for (let i = 0; i < lines.length; i++) {\n'
    '            if (lines[i].toLowerCase().indexOf(needle) === -1) continue;\n'
    '            matches.push({\n'
    '              file: path.relative(repoRoot, full),\n'
    '              line: i + 1,\n'
    '              text: lines[i].trim().slice(0, 200),\n'
    '            });\n'
)
n2 = content.count(anchor_search)
assert n2 == 1, "anchor_search count = %d" % n2

replacement_search = (
    '          const full = path.join(dir, ent.name);\n'
    '          const relFromRepo = path.relative(repoRoot, full);\n'
    '          // Branch-aware, same as resolveSafe -- otherwise search_files\n'
    '          // would keep showing the seed contents of panel.html/ebys-live.js/\n'
    '          // ebys-link.js even while a branch is active and those files have\n'
    '          // already diverged, which would send Cricket hunting for text at\n'
    '          // line numbers that do not match what read_file/apply_patch (both\n'
    '          // branch-aware via resolveSafe) actually see.\n'
    '          const effectiveFull = branchAwareFull(relFromRepo, full);\n'
    '          let text;\n'
    '          try {\n'
    '            text = fs.readFileSync(effectiveFull, "utf8");\n'
    '          } catch (e) {\n'
    '            continue; // unreadable / not text\n'
    '          }\n'
    '          const lines = text.split("\\n");\n'
    '          let hitsThisFile = 0;\n'
    '          for (let i = 0; i < lines.length; i++) {\n'
    '            if (lines[i].toLowerCase().indexOf(needle) === -1) continue;\n'
    '            matches.push({\n'
    '              file: relFromRepo,\n'
    '              line: i + 1,\n'
    '              text: lines[i].trim().slice(0, 200),\n'
    '            });\n'
)
content = content.replace(anchor_search, replacement_search, 1)

anchor_return = '  return { handleEditChat, TOOLS, resolveSafe };\n'
n3 = content.count(anchor_return)
assert n3 == 1, "anchor_return count = %d" % n3
replacement_return = '  return { handleEditChat, TOOLS, resolveSafe, getCurrentBranch, createBranch, mergeBranch };\n'
content = content.replace(anchor_return, replacement_return, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("patched edit_agent.js branches OK")
