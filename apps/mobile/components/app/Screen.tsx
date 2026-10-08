import { forwardRef, type ReactNode } from 'react';
import { RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';

import { T } from '@/constants/theme';

import { useBarInsets } from './Bars';

/** Scrollable tab screen that clears the glass top bar and bottom nav. */
export const Screen = forwardRef<ScrollView, ScrollViewProps & { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padTop?: number }>(
  function Screen({ children, refreshing, onRefresh, padTop = 14, contentContainerStyle, ...rest }, ref) {
    const bars = useBarInsets();
    return (
      <ScrollView
        ref={ref}
        {...rest}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollIndicatorInsets={{ top: bars.top, bottom: bars.bottom }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={T.rose} progressViewOffset={bars.top} /> : undefined
        }
        contentContainerStyle={[{ paddingTop: bars.top + padTop, paddingBottom: bars.bottom + 24, paddingHorizontal: 18 }, contentContainerStyle]}>
        {children}
      </ScrollView>
    );
  }
);
