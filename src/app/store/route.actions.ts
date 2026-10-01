import { createAction, props } from '@ngrx/store'
import type { ReviewComment, RiskLevel, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')
