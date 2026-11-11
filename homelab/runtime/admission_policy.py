"""Order durable jobs by submission time and reserve resources for waiting work."""
import datetime
import json
from collections import Counter
import gpu_allocation


def submission_order(job):
    request = json.loads((job/'request.json').read_text())
    status = json.loads((job/'status.json').read_text())
    value = request.get('submitted') or status.get('started')
    try:
        timestamp = datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError, AttributeError):
        timestamp = (job/'request.json').stat().st_mtime
    return timestamp, job.name


def plan(jobs, occupied, unavailable, available_ram, reserved_ram, on_hold=None):
    """Backfill disjoint resources while an older feasible job waits to start."""
    used = Counter(occupied)
    held = Counter()
    waiting_ram = 0
    result = []
    for job in sorted(jobs, key=submission_order):
        cards = gpu_allocation.select(job, used + held, unavailable)
        memory = gpu_allocation.memory_required(job)
        # Unknown scene demand stays queued until preparation records a
        # measured or declared reservation. It does not consume GPU slots.
        if memory is None:
            if on_hold is not None:
                on_hold(job, 'missing-host-memory-declaration')
            continue
        # Running reservations arrive as unspent budget above measured cgroup
        # usage; prepared reservations arrive at their full recorded amount.
        memory_fits = reserved_ram + waiting_ram + memory <= available_ram
        if cards and memory_fits:
            result.append((job, cards, memory))
            used.update(gpu_allocation.slot_costs(job, cards))
            reserved_ram += memory
        else:
            # Reserve this lane for an older job whose host memory can be admitted.
            # RAM-blocked work becomes eligible when its external reservation clears.
            desired = gpu_allocation.select(job, held, unavailable)
            if desired and memory <= available_ram:
                waiting_ram += memory
                if memory_fits:
                    held.update(gpu_allocation.slot_costs(job, desired))
    return result
