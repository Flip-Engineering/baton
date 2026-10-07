# Production-critic terminality witness over the exact reviewed Bend bytes.
#
# Reviews: bend2/src/context/runtime/cdp-runtime.bend
# SHA-256 dc36d1e75ec6c03e6cb890a1d6d882aab444d7269d8d839b1e181175561d6644
# (worktree semantic-impl-cdp, untracked at review time).
#
# Contract claim (spec 8a26bc3e, Runtime contract): an exited runtime refuses
# every non-childExit event. The JS transition function refuses adapterFailed
# after exited. The Bend advance() maps EvAdapterFailed to Failed{}
# unconditionally, so Exited -> Failed succeeds. Expected witness output on the
# current bytes is bendRefuses=False: the divergence, made concrete. An author
# fix flips this to bendRefuses=True.
#
# Remote command (admitted runner only):
#   BEND=<qualified bend 2.0.25> $BEND <dir>/cdp-terminality-witness.bend
# Place this file in the same directory as the pinned cdp-runtime.bend so the
# relative import resolves to the reviewed bytes. Witness syntax may need one
# compile iteration at admission; the single claim under test is the
# adapterFailed-after-exited branch of advance().

import Base
import ./cdp-runtime.bend as Rt

def exited_record():
  Rt.Rec{state: Rt.Exited{}, epoch: 7, mutation: 3, pending: Rt.Idle{}, liveness: Rt.LivenessExited{}}

def bend_refuses():
  match Rt.advance(exited_record(), Rt.EvAdapterFailed{}):
    case Rt.Refused{..}: True{}
    case Rt.Advanced{..}: False{}

def main():
  match bend_refuses():
    case True{}: IO.print("bendRefuses=True")
    case False{}: IO.print("bendRefuses=False")
