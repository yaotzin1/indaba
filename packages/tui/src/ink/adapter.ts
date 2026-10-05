/**
 * The only file in the repository that imports `ink` or `react`. Everything else in this package, and the rest of
 * Indaba, is written against this module, so a breaking release of either library is fixed here and nowhere else.
 * Components are written without JSX (`h` is `React.createElement`), which keeps compiler options untouched.
 */
import type { Instance, Key, RenderOptions } from 'ink';
import { Box, render, renderToString, Text, useApp, useInput, useWindowSize } from 'ink';
import { createElement, type ReactElement, useEffect, useReducer, useRef, useState } from 'react';

export type { Instance, Key, ReactElement, RenderOptions };
export {
  Box,
  createElement as h,
  render,
  renderToString,
  Text,
  useApp,
  useEffect,
  useInput,
  useReducer,
  useRef,
  useState,
  useWindowSize,
};
