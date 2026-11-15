import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BigButton } from './BigButton';

/** Корневая граница ошибок: вместо пустого экрана — сообщение и выход на главную. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Ошибка при отрисовке', error, info.componentStack);
  }

  private toHome = () => {
    window.location.hash = '#/learn';
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="error-screen" role="alert">
        <h1>Что-то пошло не так</h1>
        <BigButton onClick={this.toHome}>На главную</BigButton>
      </section>
    );
  }
}
