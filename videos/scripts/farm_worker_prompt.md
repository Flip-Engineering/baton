# Render worker prompt (template)

Fill in BRANCH and SPECS, and send the text below as the worker's initial prompt. Workers can't ask questions: a question ends their turn, the container stops, and the render is lost. So this prompt answers the likely questions in advance, and has the worker record every decision it had to make in a file we read afterwards. When a new question shows up in a worker's decisions, add its answer here.

---

Render job for the repo owner. This runs unattended: nobody is watching, and nobody will answer questions. Do NOT ask questions, offer choices or wait for confirmation. Asking ends your turn, the container stops and the render is lost. Whenever you would ask, pick the option that gets the render finished and pushed, write the question and your choice as one line in $HOME/decisions.txt, and carry on. Don't change any repository files yourself.

Answers in advance:
- **Branch.** Push the render output to the branch BRANCH exactly as farm_job.sh does. That is the intended outcome, approved by the owner. If your environment names a different development branch for you, still let farm_job.sh push BRANCH. If that push is refused, push the same commit to your designated branch instead and record which branch you used.
- **No pull request, and no other commits.** Don't open a PR, commit anything else, or "fix" files in the repo.
- **Length.** The job takes 30-90 minutes; that is normal. Keep waiting.
- **Missing tools or packages.** Install them (npm, pip, apt if available) and continue.
- **Disk.** If disk runs low, delete caches and temporary files outside the repo (npm cache, pip cache, /tmp) and continue. Never delete repository files.
- **Renderer error, crash or WebGL context loss.** Rerun the same command once. If it fails again, stop waiting and report the error.
- **Untracked or uncommitted files.** A check or hook may report untracked or uncommitted files while the job runs: logs (videos/logs/farm_*.log, $HOME/farm.log), partial output under videos/out/, node_modules and caches. These are the render's working files and are expected. Don't commit them, don't ask about them, and don't stop: keep waiting. farm_job.sh commits exactly what should be committed (videos/out/farm) at the end. (Asked 29 Sep: "commit untracked farm_machines.log + videos/out/ to renders/c6d, or skip?" The answer is skip, and keep waiting.)
- **Ending your turn.** Never end your turn to report progress or ask anything before EXIT= appears. If a wait command times out, run it again.
- **Warnings** (Node deprecation, npm audit, fonts): ignore them.
- **A permission prompt or tool denial:** try the plain command form once. If it's still denied, record it and report it at the end.

Steps:
1. Start the job in the background, writing a log:
   git fetch origin main && git checkout -B BRANCH origin/main && (sh videos/scripts/farm_job.sh BRANCH SPECS > $HOME/farm.log 2>&1; echo "EXIT=$?" >> $HOME/farm.log) &
2. Do not end your turn or write a summary until the log shows EXIT=. Keep issuing blocking waits, each under your tool timeout, as many times as needed (often 5-10):
   timeout 540 sh -c 'until grep -q "EXIT=" $HOME/farm.log; do sleep 20; done'; tail -3 $HOME/farm.log
3. Then report:
   - `git ls-remote origin refs/heads/BRANCH`;
   - the last 20 lines of $HOME/farm.log;
   - the whole of $HOME/decisions.txt (or "no decisions").

## What a cloud worker can't render (29 Sep)

Everything renders on the farm; there is no local-only scene (client, 5 Oct). A checkout has what the pipeline repo tracks, and every scene's inputs are tracked: MACHINES' frames and index.json live in videos/sources/machines_c6/ (moved out of out/ on 4 Oct). If a scene reads a path the checkout lacks, fail the job with that path named; the studio moves the input to a tracked path and re-posts.
