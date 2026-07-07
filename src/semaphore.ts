import os from "node:os";
import { BehaviorSubject, filter, lastValueFrom, take, tap } from "rxjs";

export class ConcurrencyCounter {
  static currentProcesses = new BehaviorSubject(0);
  static readonly maxProcess = os.availableParallelism();

  static acquireCounter() {
    return lastValueFrom(
      ConcurrencyCounter.currentProcesses.pipe(
        filter((current) => current < ConcurrencyCounter.maxProcess),
        take(1),
        tap(() =>
          ConcurrencyCounter.currentProcesses.next(
            ConcurrencyCounter.currentProcesses.value + 1,
          ),
        ),
      ),
    );
  }

  static releaseCounter() {
    ConcurrencyCounter.currentProcesses.next(
      ConcurrencyCounter.currentProcesses.value - 1,
    );
  }
}
