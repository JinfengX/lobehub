import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    height: 100vh;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    background: ${token.colorBgContainer};
  `,
  dragHandle: css`
    cursor: default;
    height: 4px;

    -webkit-app-region: drag;
  `,
}));
