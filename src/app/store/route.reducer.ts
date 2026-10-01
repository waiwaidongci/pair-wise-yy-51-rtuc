import { createReducer, on } from '@ngrx/store'
import type { ReviewComment, RoutePackage } from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  loading: boolean
  error: string
  version: number
}

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => ({ ...state, loading: false, routes, selectedRouteId: state.selectedRouteId || routes[0]?.id || '', selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '' })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => ({ ...route, segments: route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment) })),
  })),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route),
  })),
)
