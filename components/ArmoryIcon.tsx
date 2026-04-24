import React from 'react';
import Svg, { Rect, Circle, Line } from 'react-native-svg';

interface ArmoryIconProps {
  size?: number;
  color?: string;
  focused?: boolean;
}

export const ArmoryIcon: React.FC<ArmoryIconProps> = ({
  size = 24,
  color = '#000000',
  focused = false,
}) => {
  const opacity = focused ? 1 : 0.6;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    >
      <Rect x="1" y="1" width="22" height="22" rx="3" />
      <Line x1="4" y1="4" x2="4" y2="20" />
      <Circle cx="19.5" cy="7.5" r="1.5" fill={color} stroke="none" />
      <Circle cx="19.5" cy="16.5" r="1.5" fill={color} stroke="none" />
      <Circle cx="11.5" cy="12" r="5.5" />
      <Circle cx="11.5" cy="12" r="4" strokeOpacity={0.4} />
      <Line x1="11.5" y1="6.5" x2="11.5" y2="8" />
      <Circle cx="11.5" cy="12" r="1.25" fill={color} stroke="none" />
      <Rect x="18.5" y="10" width="3.5" height="4" rx="2" />
    </Svg>
  );
};

export default ArmoryIcon;
