import type { ButtonHTMLAttributes } from 'react';

export type BigButtonVariant = 'accent' | 'surface' | 'success' | 'weak';

type BigButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BigButtonVariant;
};

/** Объёмная кнопка с нижней тенью, как на макете mockups/boards.html. */
export function BigButton({ variant = 'accent', className, type = 'button', ...rest }: BigButtonProps) {
  const classes = ['big-button', `big-button--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
