export class ErrorBag {
  private readonly errors: string[] = [];

  add(message: string): void {
    this.errors.push(message);
  }

  all(): readonly string[] {
    return [...this.errors];
  }

  isEmpty(): boolean {
    return this.errors.length === 0;
  }
}
